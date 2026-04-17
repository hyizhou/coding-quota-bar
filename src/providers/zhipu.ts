import type { Provider, ProviderConfig, SubscriptionInfo, UsageResult } from '../shared/types';
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
 * 智谱 tool-usage API 响应类型
 */
interface ZhipuToolUsageResponse {
  code: number;
  data?: {
    x_time: string[];
    networkSearchCount: (number | null)[];
    webReadMcpCount: (number | null)[];
    zreadMcpCount: (number | null)[];
    totalUsage: {
      totalNetworkSearchCount: number;
      totalWebReadMcpCount: number;
      totalZreadMcpCount: number;
    };
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
    modelDataList?: Array<{
      modelName: string;
      sortOrder: number;
      tokensUsage: (number | null)[];
      totalTokens: number;
    }>;
  };
  msg?: string;
  success?: boolean;
}

/**
 * 智谱 model-performance-day API 响应类型
 */
interface ZhipuPerformanceResponse {
  code: number;
  data?: {
    x_time: string[];
    liteDecodeSpeed: (number | null)[];
    proMaxDecodeSpeed: (number | null)[];
    liteSuccessRate: (number | null)[];
    proMaxSuccessRate: (number | null)[];
  };
  msg?: string;
  success?: boolean;
}

/**
 * 智谱 subscription/list API 响应类型
 */
interface ZhipuSubscriptionItem {
  productName: string;
  status: string;
  valid: string;
  currentRenewTime: string;
  nextRenewTime: string;
  autoRenew: number;
  actualPrice: number;
  renewPrice: number;
  billingCycle: string;
}

interface ZhipuSubscriptionResponse {
  code: number;
  data?: ZhipuSubscriptionItem[];
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
 * 根据 limit 类型生成标签 key（由渲染进程翻译）
 */
function getLimitLabel(item: ZhipuLimitItem): { label: string; labelParams?: Record<string, string | number> } {
  if (item.type === 'TOKENS_LIMIT') {
    if (item.unit === 1) {
      return { label: 'quota.tokensLimitDaily', labelParams: { n: item.number } };
    }
    return { label: 'quota.tokensLimit', labelParams: { n: item.number } };
  }
  if (item.type === 'TIME_LIMIT') {
    return { label: 'quota.mcpUsage' };
  }
  return { label: item.type };
}

/**
 * 智谱 Coding Plan Provider
 */
export class ZhipuProvider implements Provider {
  name = '智谱';

  private httpClient = new HttpClientWithRetry(3, 1000);

  private getBaseUrl(config: ProviderConfig): string {
    return config._baseUrl as string;
  }

  async fetchUsage(config: ProviderConfig): Promise<UsageResult> {
    const apiKey = config.apiKey?.trim();
    if (!apiKey) {
      throw new Error('[Zhipu] API Key is required');
    }

    const baseUrl = this.getBaseUrl(config);
    const headers = { 'Authorization': `Bearer ${apiKey}` };

    // 1. 获取配额数据
    const quotaResp = await this.httpClient.getJson<ZhipuQuotaResponse>(
      `${baseUrl}/api/monitor/usage/quota/limit`,
      headers
    );

    if (quotaResp.code !== 200 || !quotaResp.data?.limits?.length) {
      throw new Error(`[Zhipu] Quota API error: ${quotaResp.msg || 'Unknown error'}`);
    }

    // 2. 并发请求三个时间范围的模型使用记录
    // ≤7天返回小时级数据，>7天返回天级数据
    const now = new Date();
    const start1d = new Date(now.getTime() - 1 * 86400000);
    const start7d = new Date(now.getTime() - 7 * 86400000);
    const start15d = new Date(now.getTime() - 15 * 86400000);
    const start30d = new Date(now.getTime() - 30 * 86400000);

    let resp1d: ZhipuModelUsageResponse | null = null;
    let resp7d: ZhipuModelUsageResponse | null = null;
    let resp30d: ZhipuModelUsageResponse | null = null;
    let toolResp1d: ZhipuToolUsageResponse | null = null;
    let toolResp7d: ZhipuToolUsageResponse | null = null;
    let toolResp30d: ZhipuToolUsageResponse | null = null;
    let perfResp7d: ZhipuPerformanceResponse | null = null;
    let perfResp15d: ZhipuPerformanceResponse | null = null;
    let perfResp30d: ZhipuPerformanceResponse | null = null;
    let subResp: ZhipuSubscriptionResponse | null = null;
    try {
      [resp1d, resp7d, resp30d, toolResp1d, toolResp7d, toolResp30d, perfResp7d, perfResp15d, perfResp30d, subResp] = await Promise.all([
        this.httpClient.getJson<ZhipuModelUsageResponse>(
          `${baseUrl}/api/monitor/usage/model-usage?startTime=${encodeURIComponent(formatDateTime(start1d))}&endTime=${encodeURIComponent(formatDateTime(now))}`,
          headers
        ),
        this.httpClient.getJson<ZhipuModelUsageResponse>(
          `${baseUrl}/api/monitor/usage/model-usage?startTime=${encodeURIComponent(formatDateTime(start7d))}&endTime=${encodeURIComponent(formatDateTime(now))}`,
          headers
        ),
        this.httpClient.getJson<ZhipuModelUsageResponse>(
          `${baseUrl}/api/monitor/usage/model-usage?startTime=${encodeURIComponent(formatDateTime(start30d))}&endTime=${encodeURIComponent(formatDateTime(now))}`,
          headers
        ),
        this.httpClient.getJson<ZhipuToolUsageResponse>(
          `${baseUrl}/api/monitor/usage/tool-usage?startTime=${encodeURIComponent(formatDateTime(start1d))}&endTime=${encodeURIComponent(formatDateTime(now))}`,
          headers
        ),
        this.httpClient.getJson<ZhipuToolUsageResponse>(
          `${baseUrl}/api/monitor/usage/tool-usage?startTime=${encodeURIComponent(formatDateTime(start7d))}&endTime=${encodeURIComponent(formatDateTime(now))}`,
          headers
        ),
        this.httpClient.getJson<ZhipuToolUsageResponse>(
          `${baseUrl}/api/monitor/usage/tool-usage?startTime=${encodeURIComponent(formatDateTime(start30d))}&endTime=${encodeURIComponent(formatDateTime(now))}`,
          headers
        ),
        this.httpClient.getJson<ZhipuPerformanceResponse>(
          `${baseUrl}/api/monitor/usage/model-performance-day?startTime=${encodeURIComponent(formatDateTime(start7d))}&endTime=${encodeURIComponent(formatDateTime(now))}`,
          headers
        ),
        this.httpClient.getJson<ZhipuPerformanceResponse>(
          `${baseUrl}/api/monitor/usage/model-performance-day?startTime=${encodeURIComponent(formatDateTime(start15d))}&endTime=${encodeURIComponent(formatDateTime(now))}`,
          headers
        ),
        this.httpClient.getJson<ZhipuPerformanceResponse>(
          `${baseUrl}/api/monitor/usage/model-performance-day?startTime=${encodeURIComponent(formatDateTime(start30d))}&endTime=${encodeURIComponent(formatDateTime(now))}`,
          headers
        ),
        this.httpClient.getJson<ZhipuSubscriptionResponse>(
          `${baseUrl}/api/biz/subscription/list?pageSize=9999&pageNum=1`,
          headers
        )
      ]);
    } catch (e) {
      console.warn('[Zhipu] Failed to fetch model/tool usage:', e);
    }

    // 3. 构建额度列表
    const quotas = quotaResp.data.limits.map(item => {
      const { label, labelParams } = getLimitLabel(item);
      if (item.type === 'TOKENS_LIMIT') {
        const used = resp1d?.data?.totalUsage?.totalModelCallCount ?? 0;
        const total = item.percentage > 0 ? Math.round(used / (item.percentage / 100)) : 0;
        return {
          label,
          labelParams,
          used,
          total,
          usageRate: item.percentage,
          resetAt: toISODate(item.nextResetTime),
          limitType: 'tokens' as const
        };
      }
      return {
        label,
        labelParams,
        used: item.currentValue ?? 0,
        total: item.usage ?? 0,
        usageRate: item.percentage,
        resetAt: toISODate(item.nextResetTime),
        limitType: item.type === 'TIME_LIMIT' ? 'mcp' as const : undefined
      };
    });

    // 4. 构建各时间范围的历史记录和总量
    const tokenLimit = quotaResp.data.limits.find(item => item.type === 'TOKENS_LIMIT');
    const tokenQuota = tokenLimit ? quotas[quotaResp.data.limits.indexOf(tokenLimit)] : undefined;

    // 5. 解析订阅信息
    const hasWeeklyLimit = quotaResp.data.limits.some(
      item => item.type === 'TOKENS_LIMIT' && item.unit === 1 && item.number === 7
    );
    const subscription = this.parseSubscription(subResp, quotaResp.data.level, hasWeeklyLimit);

    return {
      used: tokenQuota?.used ?? 0,
      total: tokenQuota?.total ?? 0,
      expiresAt: tokenLimit ? toISODate(tokenLimit.nextResetTime) : '',
      level: quotaResp.data.level,
      details: {
        quotas,
        subscription,
        history1d: this.buildUsageHistory(resp1d),
        history7d: this.buildUsageHistory(resp7d),
        history30d: this.buildUsageHistory(resp30d),
        totalTokens1d: resp1d?.data?.totalUsage?.totalTokensUsage ?? 0,
        totalTokens7d: resp7d?.data?.totalUsage?.totalTokensUsage ?? 0,
        totalTokens30d: resp30d?.data?.totalUsage?.totalTokensUsage ?? 0,
        mcpHistory1d: this.buildToolHistory(toolResp1d),
        mcpHistory7d: this.buildToolHistory(toolResp7d),
        mcpHistory30d: this.buildToolHistory(toolResp30d),
        modelHistory1d: this.buildModelHistory(resp1d),
        modelHistory7d: this.buildModelHistory(resp7d),
        modelHistory30d: this.buildModelHistory(resp30d),
        performanceHistory7d: this.buildPerformanceHistory(perfResp7d),
        performanceHistory15d: this.buildPerformanceHistory(perfResp15d),
        performanceHistory30d: this.buildPerformanceHistory(perfResp30d)
      }
    };
  }

  /**
   * 从 model-usage 响应构建历史记录
   * 小时级响应: 'YYYY-MM-DD HH:mm' → 'YYYY-MM-DDTHH'
   * 天级响应:   'YYYY-MM-DD'       → 'YYYY-MM-DD'（保持不变）
   */
  private buildUsageHistory(resp: ZhipuModelUsageResponse | null): Array<{ date: string; used: number }> {
    if (!resp?.data?.x_time || !resp?.data?.tokensUsage) return [];

    return resp.data.x_time
      .map((time, i) => {
        const tokens = resp.data!.tokensUsage[i];
        const hasTime = time.includes(' ');
        const date = hasTime ? time.replace(' ', 'T').slice(0, 13) : time.slice(0, 10);
        return { date, used: tokens ?? 0 };
      })
      .filter(r => r.used > 0);
  }

  /**
   * 从 tool-usage 响应构建 MCP 工具历史记录
   */
  private buildToolHistory(resp: ZhipuToolUsageResponse | null): Array<{ date: string; search: number; webRead: number; zread: number }> {
    if (!resp?.data?.x_time) return [];

    return resp.data.x_time
      .map((time, i) => {
        const hasTime = time.includes(' ');
        const date = hasTime ? time.replace(' ', 'T').slice(0, 13) : time.slice(0, 10);
        return {
          date,
          search: resp.data!.networkSearchCount[i] ?? 0,
          webRead: resp.data!.webReadMcpCount[i] ?? 0,
          zread: resp.data!.zreadMcpCount[i] ?? 0,
        };
      })
      .filter(r => r.search > 0 || r.webRead > 0 || r.zread > 0);
  }

  /**
   * 从 model-usage 响应构建分模型历史记录
   */
  private buildModelHistory(resp: ZhipuModelUsageResponse | null): Array<{ date: string; model: string; used: number }> {
    if (!resp?.data?.x_time || !resp?.data?.modelDataList) return [];

    const records: Array<{ date: string; model: string; used: number }> = [];
    for (const modelData of resp.data.modelDataList) {
      for (let i = 0; i < resp.data.x_time.length; i++) {
        const tokens = modelData.tokensUsage[i];
        if (!tokens || tokens <= 0) continue;
        const time = resp.data.x_time[i];
        const hasTime = time.includes(' ');
        const date = hasTime ? time.replace(' ', 'T').slice(0, 13) : time.slice(0, 10);
        records.push({ date, model: modelData.modelName, used: tokens });
      }
    }
    return records;
  }

  /**
   * 从 model-performance-day 响应构建性能历史记录
   */
  private buildPerformanceHistory(resp: ZhipuPerformanceResponse | null): Array<{
    date: string;
    liteDecodeSpeed: number;
    proMaxDecodeSpeed: number;
    liteSuccessRate: number;
    proMaxSuccessRate: number;
  }> {
    if (!resp?.data?.x_time) return [];
    return resp.data.x_time
      .map((time, i) => ({
        date: time.slice(0, 10),
        liteDecodeSpeed: resp.data!.liteDecodeSpeed[i] ?? 0,
        proMaxDecodeSpeed: resp.data!.proMaxDecodeSpeed[i] ?? 0,
        liteSuccessRate: resp.data!.liteSuccessRate[i] ?? 0,
        proMaxSuccessRate: resp.data!.proMaxSuccessRate[i] ?? 0,
      }))
      .filter(r => r.liteDecodeSpeed > 0 || r.proMaxDecodeSpeed > 0);
  }

  /**
   * 从订阅 API 响应解析当前有效的订阅信息
   */
  private parseSubscription(resp: ZhipuSubscriptionResponse | null, level: string, hasWeeklyLimit: boolean): SubscriptionInfo | undefined {
    if (!resp?.data?.length) return undefined;
    const sub = resp.data.find(s => s.status === 'VALID');
    if (!sub) return undefined;
    return {
      plan: hasWeeklyLimit ? `新 ${level.toUpperCase()}` : `老 ${level.toUpperCase()}`,
      status: sub.status,
      currentRenewTime: sub.currentRenewTime,
      nextRenewTime: sub.nextRenewTime,
      autoRenew: sub.autoRenew === 1,
      actualPrice: sub.actualPrice,
      renewPrice: sub.renewPrice,
      billingCycle: sub.billingCycle,
    };
  }
}
