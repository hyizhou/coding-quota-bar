import type { Provider, ProviderConfig, QuotaItem, UsageResult } from '../shared/types';
import { netFetch } from '../main/net-http';

/**
 * OpenCode Go 订阅用量查询
 * 文档：https://opencode.ai/zen/go/v1/usage
 * 鉴权：Bearer <OPENCODE_API_KEY>
 * 响应：{ usage: { rolling|weekly|monthly: { status, percent, resetsAt } } }
 * 网络层走 Electron net（Chromium 网络栈）：海外端点，需自动遵循系统代理（含 PAC），
 * 与 Codex provider 同款方案；定时刷新兜底瞬时失败，此处不做额外重试。
 */

// 60s 进程级缓存：避免多账号 / 短刷新间隔下重复请求。
// rolling 窗口虽然会随 API 调用变化，但 60s 内变化幅度 < 1%，对用户不可见。
const CACHE_TTL_MS = 60_000;
interface CacheEntry { at: number; resp: OpenCodeGoUsagePayload }
const responseCache = new Map<string, CacheEntry>();

function getCached(apiKey: string): OpenCodeGoUsagePayload | null {
  const entry = responseCache.get(apiKey);
  if (!entry) return null;
  if (Date.now() - entry.at > CACHE_TTL_MS) {
    responseCache.delete(apiKey);
    return null;
  }
  return entry.resp;
}

function setCached(apiKey: string, resp: OpenCodeGoUsagePayload): void {
  responseCache.set(apiKey, { at: Date.now(), resp });
}

interface OpenCodeGoWindow {
  status: string;
  percent: number;
  resetsAt: string;
}

interface OpenCodeGoUsagePayload {
  usage?: {
    rolling?: OpenCodeGoWindow;
    weekly?: OpenCodeGoWindow;
    monthly?: OpenCodeGoWindow;
  };
}

const OPENCODE_GO_USAGE_URL = 'https://opencode.ai/zen/go/v1/usage';

const WINDOW_LABELS = {
  rolling: { label: 'quota.opencodeGo5h', limitType: '5h' },
  weekly: { label: 'quota.opencodeGoWeekly', limitType: 'weekly' },
  monthly: { label: 'quota.opencodeGoMonthly', limitType: 'monthly' },
} as const;

type WindowKey = keyof typeof WINDOW_LABELS;
const WINDOW_ORDER: WindowKey[] = ['rolling', 'weekly', 'monthly'];

function clampPercent(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0;
}

function toIsoOrEmpty(value: unknown): string {
  if (typeof value !== 'string' || !value) return '';
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : '';
}

export class OpenCodeGoProvider implements Provider {
  name = 'OpenCode Go';

  async fetchUsage(config: ProviderConfig): Promise<UsageResult> {
    const apiKey = config.apiKey?.trim();
    if (!apiKey) {
      throw new Error('[OpenCode Go] API Key is required');
    }

    // 先查 60s 缓存
    let resp = getCached(apiKey);
    if (!resp) {
      const httpResp = await netFetch(OPENCODE_GO_USAGE_URL, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Accept': 'application/json',
        },
      });
      if (httpResp.status >= 400) {
        throw new Error(`[OpenCode Go] HTTP ${httpResp.status}: ${httpResp.body.slice(0, 120)}`);
      }
      resp = JSON.parse(httpResp.body) as OpenCodeGoUsagePayload;
      setCached(apiKey, resp);
    }

    const usage = resp.usage;
    if (!usage || typeof usage !== 'object') {
      throw new Error('[OpenCode Go] Invalid API response: missing usage block');
    }

    const quotas: QuotaItem[] = [];
    let displayRemaining = 100;

    for (const key of WINDOW_ORDER) {
      const window = usage[key];
      if (!window || window.status !== 'ok') continue;

      const used = clampPercent(window.percent);
      const remaining = 100 - used;
      const labels = WINDOW_LABELS[key];

      quotas.push({
        label: labels.label,
        used,
        total: 100,
        usageRate: used,
        resetAt: toIsoOrEmpty(window.resetsAt),
        limitType: labels.limitType,
      });

      if (remaining < displayRemaining) displayRemaining = remaining;
    }

    if (quotas.length === 0) {
      throw new Error('[OpenCode Go] No usable window data in response');
    }

    return {
      used: 100 - displayRemaining,
      total: 100,
      expiresAt: quotas[0].resetAt,
      details: { quotas },
    };
  }
}
