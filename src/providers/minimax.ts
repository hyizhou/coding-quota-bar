import type { Provider, ProviderConfig, QuotaItem, UsageResult } from '../shared/types';
import { HttpClientWithRetry } from '../main/http';

interface MiniMaxModelRemains {
  start_time?: number;
  end_time?: number;
  remains_time?: number;
  current_interval_total_count?: number;
  current_interval_usage_count?: number;
  model_name?: string;
  current_interval_status?: number;
  current_interval_remaining_percent?: number;
  current_weekly_total_count?: number;
  current_weekly_usage_count?: number;
  current_weekly_status?: number;
  current_weekly_remaining_percent?: number;
  weekly_start_time?: number;
  weekly_end_time?: number;
  weekly_remains_time?: number;
  interval_boost_permille?: number;
  weekly_boost_permille?: number;
}

interface MiniMaxRemainsResponse {
  model_remains?: MiniMaxModelRemains[];
  base_resp?: {
    status_code?: number;
    status_msg?: string;
  };
}

const DEFAULT_BASE_URL = 'https://www.minimaxi.com';
const REMAINS_PATH = '/v1/token_plan/remains';

function toNumber(value: unknown, fallback = 0): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toCount(value: unknown): number {
  return Math.max(0, Math.round(toNumber(value, 0)));
}

function clampPercent(value: unknown, fallback = 0): number {
  return Math.max(0, Math.min(100, toNumber(value, fallback)));
}

function toISODate(ts: unknown): string {
  const n = toNumber(ts, NaN);
  if (!Number.isFinite(n) || n <= 0) return '';
  const ms = n < 1_000_000_000_000 ? n * 1000 : n;
  const d = new Date(ms);
  return isNaN(d.getTime()) ? '' : d.toISOString();
}

function buildRemainsUrl(baseUrl: unknown): string {
  const raw = String(baseUrl || DEFAULT_BASE_URL).trim() || DEFAULT_BASE_URL;
  const url = new URL(raw);
  const path = url.pathname.replace(/\/+$/, '');
  if (path.endsWith(REMAINS_PATH)) {
    url.search = '';
    url.hash = '';
    return url.toString();
  }

  // API 调用地址可能配置成 /v1 或 /anthropic/v1；用量接口固定挂在 /v1/token_plan/remains。
  const rootPath = path
    .replace(/\/anthropic\/v1$/i, '')
    .replace(/\/anthropic$/i, '')
    .replace(/\/v1$/i, '');
  url.pathname = `${rootPath}${REMAINS_PATH}`.replace(/\/{2,}/g, '/');
  url.search = '';
  url.hash = '';
  return url.toString();
}

const MODEL_DISPLAY: Record<string, string> = {
  general: 'MiniMax',
  video: 'Video',
};

export class MiniMaxProvider implements Provider {
  name = 'MiniMax';

  private httpClient = new HttpClientWithRetry(3, 1000);

  async fetchUsage(config: ProviderConfig): Promise<UsageResult> {
    const apiKey = config.apiKey?.trim();
    if (!apiKey) {
      throw new Error('[MiniMax] API Key is required');
    }

    const url = buildRemainsUrl(config._baseUrl);

    const resp = await this.httpClient.getJson<MiniMaxRemainsResponse>(url, {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    });

    if (typeof resp.base_resp?.status_code === 'number' && resp.base_resp.status_code !== 0) {
      throw new Error(`[MiniMax] API error: ${resp.base_resp?.status_msg || 'Unknown error'}`);
    }

    const models = resp.model_remains ?? [];
    if (!models?.length) {
      throw new Error('[MiniMax] No model data returned');
    }

    const mainModel = models.find(m => m.model_name === 'general') || models[0];

    const quotas: QuotaItem[] = [];
    for (const m of models) {
      const modelName = m.model_name || 'unknown';
      const limitType = MODEL_DISPLAY[modelName] || modelName;

      quotas.push(this.buildQuota(
        toCount(m.current_interval_total_count), toCount(m.current_interval_usage_count),
        clampPercent(m.current_interval_remaining_percent), toCount(m.current_interval_status),
        toCount(m.interval_boost_permille),
        'quota.minimaxDaily', 'quota.minimaxDailyUnlimited',
        toISODate(m.end_time), toISODate(m.start_time), limitType,
      ));

      quotas.push(this.buildQuota(
        toCount(m.current_weekly_total_count), toCount(m.current_weekly_usage_count),
        clampPercent(m.current_weekly_remaining_percent), toCount(m.current_weekly_status),
        toCount(m.weekly_boost_permille),
        'quota.minimaxWeekly', 'quota.minimaxWeeklyUnlimited',
        toISODate(m.weekly_end_time), toISODate(m.weekly_start_time), limitType,
      ));
    }

    // 托盘只显示一个百分比，取 main model 区间/周额度里更紧张的非无限额度。
    const displayRemaining = this.getDisplayRemainingPercent(mainModel);
    const used = 100 - displayRemaining;

    return {
      used,
      total: 100,
      expiresAt: toISODate(mainModel.end_time),
      details: { quotas },
    };
  }

  // status: 1=正常有限额度, 3=无限额度; boost: 千分位配额加成(2000=2x), 仅区间且仅 general
  private buildQuota(
    total: number, usageCount: number, remainingPercent: number, status: number,
    boostPermille: number,
    normalLabel: string, unlimitedLabel: string,
    resetAt: string, startAt: string, limitType: string,
  ): QuotaItem {
    const isUnlimited = status === 3;
    const usedPercent = clampPercent(100 - remainingPercent);

    if (total > 0) {
      // 有具体计数（如 video 0/3），不加成。MiniMax 的 usage_count 在部分返回里实际表示剩余次数。
      const usedCount = this.deriveUsedCount(total, usageCount, remainingPercent);
      return {
        label: normalLabel,
        used: usedCount,
        total,
        usageRate: usedPercent,
        resetAt, startAt, limitType,
        displayUnit: 'count',
      };
    }

    if (!isUnlimited) {
      const effectiveBoost = boostPermille || 1000;
      return {
        label: normalLabel,
        labelParams: effectiveBoost > 1000 ? { boostPermille: String(effectiveBoost) } : undefined,
        used: usedPercent,
        total: 100,
        usageRate: usedPercent,
        resetAt, startAt, limitType,
        displayUnit: 'percent',
      };
    }

    // 无限额度
    return {
      label: unlimitedLabel,
      used: usageCount,
      total: 0,
      usageRate: 0,
      resetAt, startAt, limitType,
      hideBar: true,
      displayUnit: 'percent',
    };
  }

  private deriveUsedCount(total: number, usageOrRemainingCount: number, remainingPercent: number): number {
    if (total <= 0) return usageOrRemainingCount;
    const count = Math.max(0, Math.min(total, usageOrRemainingCount));
    const countPercent = (count / total) * 100;
    const usedPercent = clampPercent(100 - remainingPercent);
    const usedDelta = Math.abs(countPercent - usedPercent);
    const remainingDelta = Math.abs(countPercent - remainingPercent);
    return remainingDelta + 0.1 < usedDelta ? total - count : count;
  }

  private getDisplayRemainingPercent(model: MiniMaxModelRemains): number {
    const candidates: number[] = [];
    if (toCount(model.current_interval_status) !== 3) {
      candidates.push(clampPercent(model.current_interval_remaining_percent, 100));
    }
    if (toCount(model.current_weekly_status) !== 3) {
      candidates.push(clampPercent(model.current_weekly_remaining_percent, 100));
    }
    return candidates.length ? Math.min(...candidates) : 100;
  }
}
