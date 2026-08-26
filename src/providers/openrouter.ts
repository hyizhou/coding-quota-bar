/**
 * OpenRouter 用量查询 Provider
 */
import type { Provider, ProviderConfig, QuotaItem, UsageResult } from '../shared/types';
import { netFetch } from '../main/net-http';

interface OpenRouterCreditsResponse {
  data?: {
    total_credits?: number | string;
    total_usage?: number | string;
    balance?: number | string;
  };
}

interface OpenRouterKeyResponse {
  data?: {
    is_free_tier?: boolean;
    limit_reset?: string | null;
    usage_daily?: number | string;
    usage_weekly?: number | string;
    usage_monthly?: number | string;
    limit?: number | string;
    limit_remaining?: number | string;
    usage?: number | string;
    expires_at?: string | null;
  };
}

const OPENROUTER_CREDITS_URL = 'https://openrouter.ai/api/v1/credits';
const OPENROUTER_KEY_URL = 'https://openrouter.ai/api/v1/key';

// 60s 进程级缓存：避免多账户 / 短刷新间隔下重复请求
const CACHE_TTL_MS = 60_000;
interface CacheEntry { at: number; resp: unknown }
const responseCache = new Map<string, CacheEntry>();

function getCached(cacheKey: string): unknown | null {
  const entry = responseCache.get(cacheKey);
  if (!entry) return null;
  if (Date.now() - entry.at > CACHE_TTL_MS) {
    responseCache.delete(cacheKey);
    return null;
  }
  return entry.resp;
}

function setCached(cacheKey: string, resp: unknown): void {
  responseCache.set(cacheKey, { at: Date.now(), resp });
}

/** 金额字段可能是 JSON number 或 string，统一转有限数值 */
function toAmount(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** 判断金额字段是否存在且可解析（区分「缺省」与「值为 0」） */
function hasAmount(value: unknown): boolean {
  if (typeof value !== 'number' && typeof value !== 'string') return false;
  return Number.isFinite(Number(value));
}

export class OpenRouterProvider implements Provider {
  name = 'OpenRouter';

  async fetchUsage(config: ProviderConfig): Promise<UsageResult> {
    const apiKey = config.apiKey?.trim();
    if (!apiKey) {
      throw new Error('[OpenRouter] API Key is required');
    }

    const headers = {
      'Authorization': `Bearer ${apiKey}`,
      'Accept': 'application/json',
    };
    const [creditsSettled, keySettled] = await Promise.allSettled([
      this.request<OpenRouterCreditsResponse>(OPENROUTER_CREDITS_URL, headers, apiKey),
      this.request<OpenRouterKeyResponse>(OPENROUTER_KEY_URL, headers, apiKey),
    ]);

    const credits = creditsSettled.status === 'fulfilled' ? creditsSettled.value : null;
    const keyResp = keySettled.status === 'fulfilled' ? keySettled.value : null;

    // 两接口均失败才报错，单接口失败降级
    if (!credits && !keyResp) {
      const reasons = [creditsSettled, keySettled]
        .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
        .map(r => (r.reason instanceof Error ? r.reason.message : String(r.reason)))
        .join(' | ');
      throw new Error(`[OpenRouter] API request failed: ${reasons}`);
    }

    const creditsData = credits?.data && typeof credits.data === 'object' ? credits.data : null;
    const keyData = keyResp?.data && typeof keyResp.data === 'object' ? keyResp.data : null;

    // 余额 = 累计充值 - 累计消费；三项数值透出给账户卡（大字余额 + 小字累计）
    let balance: { amount: number; credits: number; usage: number } | null = null;
    if (creditsData) {
      const credits = toAmount(creditsData.total_credits);
      const usage = toAmount(creditsData.total_usage);
      balance = { credits, usage, amount: credits - usage };
    }

    // Key Credit limit：未设置时为 0/缺省，此时不显示进度条、不参与托盘百分比
    const limit = keyData ? toAmount(keyData.limit) : 0;
    const limitRemaining = keyData ? toAmount(keyData.limit_remaining) : 0;
    const limitReset = typeof keyData?.limit_reset === 'string' ? keyData.limit_reset : null;
    const hasLimit = limit > 0;
    let limitUsed = 0;
    if (hasLimit) {
      limitUsed = keyData && hasAmount(keyData.usage)
        ? toAmount(keyData.usage)
        : Math.max(0, limit - limitRemaining);
      limitUsed = Math.max(0, Math.min(limit, limitUsed));
    }

    const quotas: QuotaItem[] = [];

    if (hasLimit) {
      quotas.push({
        label: 'quota.openrouterKeyLimit',
        // reset 为 "daily" 时 Key 卡头部展示重置周期，其余取值不展示
        labelParams: { used: limitUsed.toFixed(2), total: limit.toFixed(2), reset: limitReset === 'daily' ? 'daily' : '' },
        used: limitUsed,
        total: limit,
        usageRate: (limitUsed / limit) * 100,
        resetAt: '',
        limitType: 'openrouter-key-limit',
        currency: 'USD',
      });
    }

    if (balance !== null) {
      quotas.push({
        label: 'quota.openrouterBalance',
        labelParams: {
          amount: balance.amount.toFixed(2),
          credits: balance.credits.toFixed(2),
          usage: balance.usage.toFixed(2),
        },
        used: balance.amount,
        total: balance.amount,
        usageRate: 0,
        resetAt: '',
        hideBar: true,
        limitType: 'openrouter-balance',
        currency: 'USD',
      });
    }

    // 周期消费：/key 接口成功即展示（含 0.00），接口整体失败则跳过
    const periods = [
      { field: 'usage_daily', label: 'quota.openrouterDailyUsage', limitType: 'openrouter-daily' },
      { field: 'usage_weekly', label: 'quota.openrouterWeeklyUsage', limitType: 'openrouter-weekly' },
      { field: 'usage_monthly', label: 'quota.openrouterMonthlyUsage', limitType: 'openrouter-monthly' },
    ] as const;

    if (keyData) {
      for (const p of periods) {
        const amount = toAmount(keyData[p.field]);
        quotas.push({
          label: p.label,
          labelParams: { amount: amount.toFixed(2) },
          used: amount,
          total: amount,
          usageRate: 0,
          resetAt: '',
          hideBar: true,
          limitType: p.limitType,
          currency: 'USD',
        });
      }
    }

    // Key 过期时间：过期后本渠道监控失效，展示为信息卡
    const expiresAt = typeof keyData?.expires_at === 'string' && Number.isFinite(Date.parse(keyData.expires_at))
      ? keyData.expires_at
      : '';
    if (expiresAt) {
      quotas.push({
        label: 'quota.openrouterKeyExpiry',
        used: 0,
        total: 0,
        usageRate: 0,
        resetAt: expiresAt,
        hideBar: true,
        limitType: 'openrouter-expiry',
      });
    }

    if (quotas.length === 0) {
      throw new Error('[OpenRouter] No usable data in API response');
    }

    return {
      // 无 Key 限额时 total=0，聚合器视为 100%（不拖低托盘百分比）
      used: hasLimit ? limitUsed : 0,
      total: hasLimit ? limit : 0,
      expiresAt: '',
      details: { quotas, currency: 'USD' },
    };
  }

  /** 带缓存的 GET 请求，失败不缓存（下次刷新立即重试） */
  private async request<T>(url: string, headers: Record<string, string>, apiKey: string): Promise<T> {
    const cacheKey = `${url}#${apiKey}`;
    const cached = getCached(cacheKey);
    if (cached) return cached as T;

    const httpResp = await netFetch(url, { headers });
    if (httpResp.status >= 400) {
      throw new Error(`[OpenRouter] HTTP ${httpResp.status} (${url.replace('https://openrouter.ai', '')}): ${httpResp.body.slice(0, 120)}`);
    }
    const resp = JSON.parse(httpResp.body) as T;
    setCached(cacheKey, resp);
    return resp;
  }
}
