import type { Provider, ProviderConfig, SubscriptionInfo, UsageResult } from '../shared/types';
import { HttpClientWithRetry } from '../main/http';
import pricingConfig from './zai-pricing.json';

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
    if (item.unit === 3) {
      return { label: 'quota.tokensLimit', labelParams: { n: item.number } };
    }
    return { label: 'quota.tokensLimitDaily' };
  }
  if (item.type === 'TIME_LIMIT') {
    return { label: 'quota.mcpUsage' };
  }
  return { label: item.type };
}

/**
 * 定价数据从 zhipu-pricing.json 加载，价格变更时只需更新该文件
 */
interface ModelPricing {
  cache: number;
  input: number;
  output: number;
  tier?: string;
  note?: string;
}

const { models: RAW_MODEL_PRICING, tokenRatio: TOKEN_RATIO, fallbackModel: FALLBACK_MODEL } = pricingConfig as {
  models: Record<string, ModelPricing>;
  tokenRatio: { cache: number; input: number; output: number };
  fallbackModel?: string;
};

// 大小写不敏感的 pricing lookup：API 返回 "glm-5.2" 或 "GLM-5.2" 都能匹配
const MODEL_PRICING_LOOKUP: Map<string, ModelPricing> = (() => {
  const map = new Map<string, ModelPricing>();
  for (const [key, value] of Object.entries(RAW_MODEL_PRICING)) {
    map.set(key.toLowerCase(), value);
  }
  return map;
})();

function getPricing(modelName: string): ModelPricing | undefined {
  if (!modelName) return undefined;
  const direct = RAW_MODEL_PRICING[modelName];
  if (direct) return direct;
  const caseInsensitive = MODEL_PRICING_LOOKUP.get(modelName.toLowerCase());
  if (caseInsensitive) return caseInsensitive;
  // 未知模型兜底到 fallbackModel（默认 GLM-5.1）
  if (FALLBACK_MODEL) {
    return RAW_MODEL_PRICING[FALLBACK_MODEL] ?? MODEL_PRICING_LOOKUP.get(FALLBACK_MODEL.toLowerCase());
  }
  return undefined;
}

/**
 * 根据 modelDataList 估算 API 调用费用
 */
function calcEstimatedCost(resp: ZhipuModelUsageResponse | null): number {
  if (!resp?.data?.modelDataList) return 0;
  let total = 0;
  for (const model of resp.data.modelDataList) {
    const pricing = getPricing(model.modelName);
    if (!pricing) continue;
    const mTokens = model.totalTokens / 1_000_000;
    total += mTokens * (
      TOKEN_RATIO.cache * pricing.cache +
      TOKEN_RATIO.input * pricing.input +
      TOKEN_RATIO.output * pricing.output
    );
  }
  return Math.round(total * 100) / 100;
}

/**
 * 按 tokenRatio 加权 cache/input/output 三档价格，得到每模型等效单价（元/百万token）
 */
function calcRate(p: ModelPricing): number {
  return Math.round((
    TOKEN_RATIO.cache * p.cache +
    TOKEN_RATIO.input * p.input +
    TOKEN_RATIO.output * p.output
  ) * 100) / 100;
}

/**
 * 静态 modelRates：仅包含 JSON 里的已知模型。
 * 主要给 UI 渲染「定价参考表」用，渲染进程可遍历。
 */
const STATIC_MODEL_RATES: Record<string, number> = (() => {
  const rates: Record<string, number> = {};
  for (const [name, p] of Object.entries(RAW_MODEL_PRICING)) {
    rates[name] = calcRate(p);
  }
  return rates;
})();

/**
 * 运行时 modelRates：基于本次 API 返回的 modelDataList 构建。
 * 已知模型用 JSON 里的精确价；未知模型（包括未来 GLM-5.4、6.0 等）走 fallbackModel 兜底。
 *
 * 为什么需要这个：STATIC_MODEL_RATES 只含 JSON 里的模型，如果智谱上线新模型后 API 返回
 * modelDataList 里出现该模型名，TokenChart 的「分模型费用明细」会查不到 rate，导致那行
 * 显示空、但总费用里又用 calcEstimatedCost() 走了兜底算上了——数据对不上，用户会困惑。
 * 这里把分模型明细也用同样的兜底策略，保证「总费用 = 明细相加」。
 */
function buildRuntimeModelRates(
  modelDataLists: Array<NonNullable<ZhipuModelUsageResponse['data']>['modelDataList'] | undefined>
): Record<string, number> {
  const rates: Record<string, number> = { ...STATIC_MODEL_RATES };
  for (const list of modelDataLists) {
    if (!list) continue;
    for (const m of list) {
      if (rates[m.modelName] !== undefined) continue;  // 已存在（含大小写匹配）就跳过
      // getPricing() 已含大小写不敏感 + fallbackModel 兜底
      const pricing = getPricing(m.modelName);
      if (!pricing) continue;
      rates[m.modelName] = calcRate(pricing);
    }
  }
  return rates;
}

/**
 * 智谱 Coding Plan Provider
 */
export class ZhipuProvider implements Provider {
  name = '智谱';

  private httpClient = new HttpClientWithRetry(3, 1000);
  // 关键请求（quota/limit）：重试更多次、退避更长，避免一次间歇性网络错误就让整个面板无数据
  private criticalClient = new HttpClientWithRetry(5, 1200);

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

    // 1. 获取配额数据（关键请求，单独用更高重试次数的 client）
    const quotaResp = await this.criticalClient.getJson<ZhipuQuotaResponse>(
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

    // 用「限流并发 + allSettled」请求辅助数据：
    //  - 限流（最多 2 路同时）避免对同一 host 瞬间打出 10 条连接触发服务端/代理限流，
    //    导致 ERR_CONNECTION_CLOSED（实测 2 路并发比 10 路全并发更稳更快）。
    //  - allSettled 让单条失败不连累其余请求（每条内部已有重试）。
    const auxRequests: Array<() => Promise<unknown>> = [
      () => this.httpClient.getJson<ZhipuModelUsageResponse>(
        `${baseUrl}/api/monitor/usage/model-usage?startTime=${encodeURIComponent(formatDateTime(start1d))}&endTime=${encodeURIComponent(formatDateTime(now))}`,
        headers
      ),
      () => this.httpClient.getJson<ZhipuModelUsageResponse>(
        `${baseUrl}/api/monitor/usage/model-usage?startTime=${encodeURIComponent(formatDateTime(start7d))}&endTime=${encodeURIComponent(formatDateTime(now))}`,
        headers
      ),
      () => this.httpClient.getJson<ZhipuModelUsageResponse>(
        `${baseUrl}/api/monitor/usage/model-usage?startTime=${encodeURIComponent(formatDateTime(start30d))}&endTime=${encodeURIComponent(formatDateTime(now))}`,
        headers
      ),
      () => this.httpClient.getJson<ZhipuToolUsageResponse>(
        `${baseUrl}/api/monitor/usage/tool-usage?startTime=${encodeURIComponent(formatDateTime(start1d))}&endTime=${encodeURIComponent(formatDateTime(now))}`,
        headers
      ),
      () => this.httpClient.getJson<ZhipuToolUsageResponse>(
        `${baseUrl}/api/monitor/usage/tool-usage?startTime=${encodeURIComponent(formatDateTime(start7d))}&endTime=${encodeURIComponent(formatDateTime(now))}`,
        headers
      ),
      () => this.httpClient.getJson<ZhipuToolUsageResponse>(
        `${baseUrl}/api/monitor/usage/tool-usage?startTime=${encodeURIComponent(formatDateTime(start30d))}&endTime=${encodeURIComponent(formatDateTime(now))}`,
        headers
      ),
      () => this.httpClient.getJson<ZhipuPerformanceResponse>(
        `${baseUrl}/api/monitor/usage/model-performance-day?startTime=${encodeURIComponent(formatDateTime(start7d))}&endTime=${encodeURIComponent(formatDateTime(now))}`,
        headers
      ),
      () => this.httpClient.getJson<ZhipuPerformanceResponse>(
        `${baseUrl}/api/monitor/usage/model-performance-day?startTime=${encodeURIComponent(formatDateTime(start15d))}&endTime=${encodeURIComponent(formatDateTime(now))}`,
        headers
      ),
      () => this.httpClient.getJson<ZhipuPerformanceResponse>(
        `${baseUrl}/api/monitor/usage/model-performance-day?startTime=${encodeURIComponent(formatDateTime(start30d))}&endTime=${encodeURIComponent(formatDateTime(now))}`,
        headers
      ),
      () => this.httpClient.getJson<ZhipuSubscriptionResponse>(
        `${baseUrl}/api/biz/subscription/list?pageSize=9999&pageNum=1`,
        headers
      )
    ];

    const settled = await this.runLimitedAllSettled(auxRequests, 2);

    /**
     * 从 allSettled 结果中提取值，失败时记录并返回 null
     */
    const pick = <T>(i: number): T | null => {
      const s = settled[i] as PromiseSettledResult<T>;
      if (s.status === 'fulfilled') return s.value;
      const reason = s.reason instanceof Error ? s.reason.message : String(s.reason);
      console.warn(`[Zhipu] request #${i} failed:`, reason);
      return null;
    };

    const resp1d = pick<ZhipuModelUsageResponse>(0);
    const resp7d = pick<ZhipuModelUsageResponse>(1);
    const resp30d = pick<ZhipuModelUsageResponse>(2);
    const toolResp1d = pick<ZhipuToolUsageResponse>(3);
    const toolResp7d = pick<ZhipuToolUsageResponse>(4);
    const toolResp30d = pick<ZhipuToolUsageResponse>(5);
    const perfResp7d = pick<ZhipuPerformanceResponse>(6);
    const perfResp15d = pick<ZhipuPerformanceResponse>(7);
    const perfResp30d = pick<ZhipuPerformanceResponse>(8);
    const subResp = pick<ZhipuSubscriptionResponse>(9);

    // 3. 构建额度列表
    const quotas = quotaResp.data.limits.map(item => {
      const { label, labelParams } = getLimitLabel(item);
      // 周期长度：unit=3 小时 / unit=1 天 / unit=5 月 / 其他按天估算
      const periodHours =
        item.unit === 3 ? item.number :
        item.unit === 1 ? item.number * 24 :
        item.unit === 5 ? item.number * 30 * 24 :
        item.number * 24;  // 兜底
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
          periodHours,
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
        periodHours,
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
    const subscription = this.parseSubscription(subResp, quotaResp.data.level ?? '', hasWeeklyLimit);

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
        estimatedCost1d: calcEstimatedCost(resp1d),
        estimatedCost7d: calcEstimatedCost(resp7d),
        estimatedCost30d: calcEstimatedCost(resp30d),
        modelRates: buildRuntimeModelRates([resp1d?.data?.modelDataList, resp7d?.data?.modelDataList, resp30d?.data?.modelDataList]),
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
   * 限流并发执行任务，最多同时 limit 个进行中。
   * 用 allSettled 语义：单任务失败不影响其他，结果顺序与输入一致。
   * 用于避免对同一 host 瞬间打出过多连接。
   */
  private async runLimitedAllSettled<T>(
    tasks: Array<() => Promise<T>>,
    limit: number
  ): Promise<PromiseSettledResult<T>[]> {
    const results: PromiseSettledResult<T>[] = new Array(tasks.length);
    let next = 0;
    const worker = async () => {
      while (true) {
        const i = next++;
        if (i >= tasks.length) return;
        try {
          results[i] = { status: 'fulfilled', value: await tasks[i]() };
        } catch (e) {
          results[i] = { status: 'rejected', reason: e };
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, () => worker()));
    return results;
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
   * 从订阅 API 响应解析订阅信息
   *
   * status='VALID' 是确定的取值，优先用它定位当前订阅。
   * 找不到 VALID 时，因 status 其他取值含义未知，用 nextRenewTime 兜底
   * 判断是否已过期，到期即标记为 EXPIRED，让 UI 显示"已过期"徽章。
   */
  private parseSubscription(resp: ZhipuSubscriptionResponse | null, level: string, hasWeeklyLimit: boolean): SubscriptionInfo | undefined {
    if (!resp?.data?.length) return undefined;

    // 优先 status='VALID'；找不到时取 nextRenewTime 最晚且有效的一条
    const validSub = resp.data.find(s => s.status === 'VALID');
    const fallbackSub = [...resp.data]
      .filter(s => {
        const t = new Date(s.nextRenewTime).getTime();
        return !isNaN(t);
      })
      .sort((a, b) =>
        new Date(b.nextRenewTime).getTime() - new Date(a.nextRenewTime).getTime()
      )[0];
    const sub = validSub ?? fallbackSub;
    if (!sub) return undefined;

    // 仅在非 VALID 状态下用时间兜底判断
    const renewTime = new Date(sub.nextRenewTime);
    const isExpired = !validSub
      && !isNaN(renewTime.getTime()) && renewTime.getTime() < Date.now();

    return {
      plan: hasWeeklyLimit ? `新 ${level.toUpperCase()}` : `老 ${level.toUpperCase()}`,
      status: isExpired ? 'EXPIRED' : 'VALID',
      currentRenewTime: sub.currentRenewTime,
      nextRenewTime: sub.nextRenewTime,
      autoRenew: sub.autoRenew === 1,
      actualPrice: sub.actualPrice,
      renewPrice: sub.renewPrice,
      billingCycle: sub.billingCycle,
    };
  }
}
