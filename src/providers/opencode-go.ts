import type { Provider, ProviderConfig, QuotaItem, UsageResult } from '../shared/types';
import { HttpClientWithRetry } from '../main/http';

/**
 * OpenCode Go 订阅用量查询
 * 文档：https://opencode.ai/zen/go/v1/usage
 * 鉴权：Bearer <OPENCODE_API_KEY>
 * 响应：{ usage: { rolling|weekly|monthly: { status, percent, resetsAt } } }
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

function toFiniteNumber(value: unknown, fallback = 0): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clampPercent(value: unknown): number {
  return Math.max(0, Math.min(100, toFiniteNumber(value, 0)));
}

function toIsoOrEmpty(value: unknown): string {
  if (typeof value !== 'string' || !value) return '';
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : '';
}

export class OpenCodeGoProvider implements Provider {
  name = 'OpenCode Go';

  private httpClient = new HttpClientWithRetry(3, 1000);

  async fetchUsage(config: ProviderConfig): Promise<UsageResult> {
    const apiKey = config.apiKey?.trim();
    if (!apiKey) {
      throw new Error('[OpenCode Go] API Key is required');
    }

    // 先查 60s 缓存
    let resp = getCached(apiKey);
    if (!resp) {
      resp = await this.httpClient.getJson<OpenCodeGoUsagePayload>(OPENCODE_GO_USAGE_URL, {
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'application/json',
      });
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
        displayUnit: 'percent',
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
