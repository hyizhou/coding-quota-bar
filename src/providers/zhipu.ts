import type { Provider, ProviderConfig, UsageResult } from '../shared/types';
import { HttpClientWithRetry } from '../main/http';

/**
 * 智谱 quota/limit API 响应类型
 */
interface ZhipuLimitItem {
  type: string;
  unit: number;            // 重置周期单位（3=小时, 5=月）
  number: number;          // 重置周期数值
  usage?: number;          // 总额度（TIME_LIMIT 有此字段）
  currentValue?: number;   // 已用量（TIME_LIMIT 有此字段）
  remaining?: number;      // 剩余量（TIME_LIMIT 有此字段）
  percentage: number;      // 已用百分比 0-100
  nextResetTime: number;   // 下次重置时间 (毫秒时间戳)
  usageDetails?: Array<{ modelCode: string; usage: number }>;
}

interface ZhipuQuotaResponse {
  code: number;
  data?: {
    limits: ZhipuLimitItem[];
    level?: string;
  };
  msg?: string;
  success?: boolean;
}

/**
 * 智谱 model-usage API 响应类型
 */
interface ZhipuModelUsageResponse {
  code: number;
  data?: {
    x_time: string[];
    modelCallCount: (number | null)[];
    tokensUsage: (number | null)[];
    totalUsage: {
      totalModelCallCount: number;
      totalTokensUsage: number;
    };
  };
  msg?: string;
  success?: boolean;
}

/**
 * 格式化日期为 API 要求的格式
 */
function formatDateTime(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/**
 * 安全地将时间戳转为 ISO 字符串，无效值返回空串
 */
function toISODate(ts: number | undefined | null): string {
  if (ts == null || !Number.isFinite(ts)) return '';
  const d = new Date(ts);
  return isNaN(d.getTime()) ? '' : d.toISOString();
}

/**
 * 根据 limit 类型生成标签
 */
function getLimitLabel(item: ZhipuLimitItem): string {
  if (item.type === 'TOKENS_LIMIT') {
    return `Token 用量 (${item.number}小时)`;
  }
  if (item.type === 'TIME_LIMIT') {
    return `MCP 用量 (${item.number}个月)`;
  }
  return item.type;
}

/**
 * 智谱 Coding Plan Provider
 */
export class ZhipuProvider implements Provider {
  name = '智谱';

  private readonly QUOTA_ENDPOINT = 'https://bigmodel.cn/api/monitor/usage/quota/limit';
  private readonly MODEL_USAGE_ENDPOINT = 'https://bigmodel.cn/api/monitor/usage/model-usage';
  private httpClient = new HttpClientWithRetry(3, 1000);

  async fetchUsage(config: ProviderConfig): Promise<UsageResult> {
    const apiKey = config.apiKey?.trim();
    if (!apiKey) {
      throw new Error('[Zhipu] API Key is required');
    }

    const headers = { 'Authorization': `Bearer ${apiKey}` };

    // 1. 获取配额数据
    const quotaResp = await this.httpClient.getJson<ZhipuQuotaResponse>(
      this.QUOTA_ENDPOINT,
      headers
    );

    if (quotaResp.code !== 200 || !quotaResp.data?.limits?.length) {
      throw new Error(`[Zhipu] Quota API error: ${quotaResp.msg || 'Unknown error'}`);
    }

    // 2. 获取模型使用记录（用于 TOKENS_LIMIT 的实际用量 + 历史记录）
    const tokenLimit = quotaResp.data.limits.find(item => item.type === 'TOKENS_LIMIT');
    const windowHours = tokenLimit?.number ?? 5;
    const now = new Date();
    const windowStart = new Date(now.getTime() - windowHours * 3600000);

    let modelUsageResp: ZhipuModelUsageResponse | null = null;
    try {
      const url = `${this.MODEL_USAGE_ENDPOINT}?startTime=${encodeURIComponent(formatDateTime(windowStart))}&endTime=${encodeURIComponent(formatDateTime(now))}`;
      modelUsageResp = await this.httpClient.getJson<ZhipuModelUsageResponse>(url, headers);
    } catch (e) {
      console.warn('[Zhipu] Failed to fetch model usage:', e);
    }

    // 3. 构建额度列表
    const quotas = quotaResp.data.limits.map(item => {
      if (item.type === 'TOKENS_LIMIT') {
        // TOKENS_LIMIT API 不返回具体用量，从 model-usage 获取
        const used = modelUsageResp?.data?.totalUsage?.totalTokensUsage ?? 0;
        const total = item.percentage > 0 ? Math.round(used / (item.percentage / 100)) : 0;
        return {
          label: getLimitLabel(item),
          used,
          total,
          usageRate: item.percentage,
          resetAt: toISODate(item.nextResetTime)
        };
      }
      // TIME_LIMIT：API 直接提供具体用量
      return {
        label: getLimitLabel(item),
        used: item.currentValue ?? 0,
        total: item.usage ?? 0,
        usageRate: item.percentage,
        resetAt: toISODate(item.nextResetTime)
      };
    });

    // 4. 构建历史使用记录
    const usageHistory = this.buildUsageHistory(modelUsageResp);

    // 5. 构建结果（主指标取 TOKENS_LIMIT）
    const tokenQuota = quotas.find(q => q.label.includes('Token'));

    return {
      used: tokenQuota?.used ?? 0,
      total: tokenQuota?.total ?? 0,
      expiresAt: tokenLimit ? toISODate(tokenLimit.nextResetTime) : '',
      level: quotaResp.data.level,
      details: {
        quotas,
        usageHistory
      }
    };
  }

  /**
   * 从 model-usage 响应构建历史记录
   * API 返回 'YYYY-MM-DD HH:mm'，转换为 'YYYY-MM-DDTHH' 格式
   */
  private buildUsageHistory(resp: ZhipuModelUsageResponse | null): Array<{ date: string; used: number }> {
    if (!resp?.data?.x_time || !resp?.data?.tokensUsage) return [];

    return resp.data.x_time
      .map((time, i) => {
        const tokens = resp.data!.tokensUsage[i];
        return {
          date: time.replace(' ', 'T').slice(0, 13),
          used: tokens ?? 0
        };
      })
      .filter(r => r.used > 0);
  }
}
