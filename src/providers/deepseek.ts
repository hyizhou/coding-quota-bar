/**
 * DeepSeek Provider：API Key 模式（官方余额接口）+ 网页登录模式（开放平台内部 API）
 * 以及 status.deepseek.com 服务状态采集（Flashcat 状态页）。
 * 接口协议见 docs/deepseek/web-api-v2.md 与 status-api-v2.md。
 */
import type { Provider, ProviderConfig, QuotaItem, UsageResult, DeepSeekServiceComponent, DayStatus, ModelCostRecord, ToolCallRecord } from '../shared/types';
import { HttpClient, HttpClientWithRetry } from '../main/http';

// ==================== API Key 模式（官方接口） ====================

interface BalanceInfo {
  currency: string;
  total_balance: string;
  granted_balance: string;
  topped_up_balance: string;
}

interface BalanceResponse {
  is_available: boolean;
  balance_infos: BalanceInfo[];
}

// ==================== 服务状态（Flashcat 状态页） ====================

const STATUS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
let statusCache: { data: DeepSeekServiceComponent[]; ts: number } | null = null;

const STATUS_DAYS = 90;

const TOKEN_EXPIRED = 'TOKEN_EXPIRED';

interface FlashcatComponent {
  component_id: string;
  section_id?: string;
  name: string;
  description?: string;
  order_id?: number;
}

interface FlashcatSection {
  section_id: string;
  name: string;
  order_id?: number;
}

interface FlashcatActiveChange {
  id?: number;
  title?: string;
  components?: Array<{ component_id: string; new_status: string }>;
}

interface FlashcatActiveResponse {
  data?: {
    page?: {
      components: FlashcatComponent[];
      sections?: FlashcatSection[];
    };
    active_changes?: FlashcatActiveChange[];
  };
}

interface FlashcatImpact {
  component_id?: string;
  section_id?: string;
  start_at_seconds: number;
  end_at_seconds?: number;
  status: string;
}

interface FlashcatUptime {
  component_id?: string;
  section_id?: string;
  uptime: number;
}

interface FlashcatStructureResponse {
  data?: {
    component_impacts?: FlashcatImpact[];
    section_impacts?: FlashcatImpact[];
    component_uptimes?: FlashcatUptime[];
    section_uptimes?: FlashcatUptime[];
  };
}

const IMPACT_SEVERITY: Record<string, number> = {
  maintenance: 1,
  degraded: 1,
  partial_outage: 2,
  full_outage: 3,
};

function toComponentStatus(status: string): DeepSeekServiceComponent['status'] {
  if (status === 'full_outage') return 'major_outage';
  if (status === 'partial_outage') return 'partial_outage';
  if (status === 'degraded') return 'degraded_performance';
  return 'operational';
}

/** 由故障时间段推导 90 天日历色块与累计不可用分钟数 */
function buildDayStatuses(impacts: FlashcatImpact[], today: Date): { days: DayStatus[]; downMinutes: number } {
  const days: DayStatus[] = [];
  let downMinutes = 0;

  for (let i = STATUS_DAYS - 1; i >= 0; i--) {
    const dayStart = new Date(today);
    dayStart.setDate(dayStart.getDate() - i);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);

    let dayStatus: DayStatus = 'operational';

    for (const imp of impacts) {
      const impStart = new Date(imp.start_at_seconds * 1000);
      const impEnd = new Date((imp.end_at_seconds ?? imp.start_at_seconds) * 1000);

      const overlapStart = impStart > dayStart ? impStart : dayStart;
      const overlapEnd = impEnd < dayEnd ? impEnd : dayEnd;
      if (overlapStart >= overlapEnd) continue;

      downMinutes += (overlapEnd.getTime() - overlapStart.getTime()) / 60000;

      if (imp.status === 'full_outage') {
        dayStatus = 'outage';
        break;
      } else if (imp.status === 'partial_outage') {
        if (dayStatus === 'operational') dayStatus = 'outage';
      } else if (imp.status === 'degraded') {
        if (dayStatus === 'operational') dayStatus = 'degraded';
      } else if (imp.status === 'maintenance') {
        if (dayStatus === 'operational') dayStatus = 'maintenance';
      }
    }

    days.push(dayStatus);
  }

  return { days, downMinutes };
}

export async function fetchServiceStatus(): Promise<DeepSeekServiceComponent[]> {
  if (statusCache && Date.now() - statusCache.ts < STATUS_CACHE_TTL) {
    return statusCache.data;
  }

  try {
    const PAGE_ID = '6410630422455';
    const baseUrl = 'https://status.deepseek.com/api/status-page';

    const nowMs = Date.now();
    const endSeconds = Math.floor(nowMs / 1000);
    const startSeconds = endSeconds - STATUS_DAYS * 86400;

    const statusHeaders = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
      'Accept': 'application/json',
    };

    const [activeResp, structureResp] = await Promise.all([
      HttpClient.getJson<FlashcatActiveResponse>(`${baseUrl}/${PAGE_ID}/summary/active`, statusHeaders),
      HttpClient.getJson<FlashcatStructureResponse>(
        `${baseUrl}/${PAGE_ID}/summary/structure?start_at_from_seconds=${startSeconds}&start_at_to_seconds=${endSeconds}`,
        statusHeaders,
      ),
    ]);

    const page = activeResp.data?.page;
    const components = (page?.components ?? []).filter(comp => !comp.section_id);
    const sections = page?.sections ?? [];
    const activeChanges = activeResp.data?.active_changes ?? [];
    const structure = structureResp.data ?? {};
    const componentImpacts = structure.component_impacts ?? [];
    const sectionImpacts = structure.section_impacts ?? [];

    // 当前状态来源一：活跃事件中的组件状态
    const activeStatusById = new Map<string, string>();
    for (const ch of activeChanges) {
      for (const c of ch.components ?? []) {
        activeStatusById.set(c.component_id, c.new_status);
      }
    }

    // 当前状态来源二：未结束的故障记录（按严重度取最高）
    const ongoingStatusById = new Map<string, string>();
    for (const imp of [...componentImpacts, ...sectionImpacts]) {
      const id = imp.component_id || imp.section_id;
      if (!id) continue;
      if (typeof imp.end_at_seconds === 'number' && imp.end_at_seconds <= endSeconds) continue;
      const current = ongoingStatusById.get(id);
      if (!current || (IMPACT_SEVERITY[imp.status] ?? 0) > (IMPACT_SEVERITY[current] ?? 0)) {
        ongoingStatusById.set(id, imp.status);
      }
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const totalMinutes = STATUS_DAYS * 24 * 60;

    const buildCard = (
      id: string,
      name: string,
      impacts: FlashcatImpact[],
      serverUptime: number | undefined,
    ): DeepSeekServiceComponent => {
      const { days, downMinutes } = buildDayStatuses(impacts, today);
      const uptime = serverUptime ?? Math.max(0, ((totalMinutes - downMinutes) / totalMinutes) * 100);
      const status = activeStatusById.get(id) ?? ongoingStatusById.get(id) ?? '';
      return {
        id,
        name,
        status: toComponentStatus(status),
        days,
        uptime: Math.round(uptime * 100) / 100,
      };
    };

    // 顶层组件各一张卡；分组组件由分组卡聚合展示
    const result: DeepSeekServiceComponent[] = [
      ...components.map(comp => buildCard(
        comp.component_id,
        comp.name,
        componentImpacts.filter(imp => imp.component_id === comp.component_id),
        structure.component_uptimes?.find(u => u.component_id === comp.component_id)?.uptime,
      )),
      ...sections.map(section => buildCard(
        section.section_id,
        section.name,
        sectionImpacts.filter(imp => imp.section_id === section.section_id),
        structure.section_uptimes?.find(u => u.section_id === section.section_id)?.uptime,
      )),
    ];

    statusCache = { data: result, ts: Date.now() };
    return result;
  } catch (e) {
    console.warn('[DeepSeek] Failed to fetch service status:', e);
    return statusCache?.data ?? [];
  }
}

// ==================== 网页登录模式（开放平台内部 API，按 Key 维度） ====================

const DEEPSEEK_TZ_OFFSET = 8 * 3600; // 页面口径：GMT+8

interface InternalApiData<T> {
  code: number;
  msg?: string;
  data?: { biz_code: number; biz_msg: string; biz_data: T };
}

interface UserSummaryBizData {
  normal_wallets: Array<{ currency: string; balance: string; token_estimation: string }>;
  bonus_wallets: Array<{ currency: string; balance: string; token_estimation: string }>;
  total_costs: Array<{ currency: string; amount: string }>;
}

interface ApiKeyRef {
  tracking_id: string;
  name: string;
  sensitive_id: string;
  valid: boolean;
  key_type: string;
}

interface AmountUsage {
  RESPONSE_TOKEN?: number;
  REQUEST?: number;
  PROMPT_CACHE_HIT_TOKEN?: number;
  PROMPT_CACHE_MISS_TOKEN?: number;
  FUNCTION_CALL?: number;   // function_series 中的工具调用次数
}

interface AmountSeriesEntry {
  api_key: ApiKeyRef;
  model: string;
  buckets: Array<{ time: number; usage?: AmountUsage }>;
}

interface ByApiKeyAmountBiz {
  start: number;
  end: number;
  bucket: number;
  models: string[];
  series?: AmountSeriesEntry[];
  function_series?: AmountSeriesEntry[];
}

interface CostSeriesEntry {
  api_key: ApiKeyRef;
  model: string;
  buckets: Array<{ time: number; cost: string }>;
}

interface ByApiKeyCostBiz {
  start: number;
  end: number;
  bucket: number;
  models: string[];
  functions?: string[];
  data?: Array<{
    currency: string;
    series?: CostSeriesEntry[];
    function_series?: CostSeriesEntry[];
  }>;
}

/** 桶起点 Unix 秒 → GMT+8 本地日期字符串（YYYY-MM-DD） */
function bucketDate(timeSeconds: number): string {
  return new Date((timeSeconds + DEEPSEEK_TZ_OFFSET) * 1000).toISOString().slice(0, 10);
}

/** 指定月份（GMT+8 口径）的查询区间；当前月份的 end 截止到明天 0 点（与页面一致） */
function monthRangeGmt8(now: Date, year: number, month: number): { start: number; end: number } {
  const start = Math.floor((Date.UTC(year, month - 1, 1) - DEEPSEEK_TZ_OFFSET * 1000) / 1000);
  const nextMonthStart = Math.floor((Date.UTC(year, month, 1) - DEEPSEEK_TZ_OFFSET * 1000) / 1000);

  const shifted = new Date(now.getTime() + DEEPSEEK_TZ_OFFSET * 1000);
  shifted.setUTCDate(shifted.getUTCDate() + 1);
  shifted.setUTCHours(0, 0, 0, 0);
  const tomorrowMidnight = Math.floor(shifted.getTime() / 1000 - DEEPSEEK_TZ_OFFSET);

  return { start, end: Math.min(nextMonthStart, tomorrowMidnight) };
}

/** 当前月份（GMT+8 口径） */
function currentMonthGmt8(now: Date): { year: number; month: number } {
  const shifted = new Date(now.getTime() + DEEPSEEK_TZ_OFFSET * 1000);
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1 };
}

/** by_api_key/amount → 分模型逐日 Token 记录（跨 API Key 按「日期 × 模型」合并） */
function parseAmountBiz(biz: ByApiKeyAmountBiz | undefined): import('../shared/types').ModelTokenRecord[] {
  if (!biz?.series) return [];

  const byKey = new Map<string, import('../shared/types').ModelTokenRecord>();
  for (const entry of biz.series) {
    for (const b of entry.buckets ?? []) {
      const cacheHit = b.usage?.PROMPT_CACHE_HIT_TOKEN ?? 0;
      const cacheMiss = b.usage?.PROMPT_CACHE_MISS_TOKEN ?? 0;
      const response = b.usage?.RESPONSE_TOKEN ?? 0;
      const requests = b.usage?.REQUEST ?? 0;
      const used = cacheHit + cacheMiss + response;
      if (used <= 0 && requests <= 0) continue;

      const date = bucketDate(b.time);
      const key = `${date}|${entry.model}`;
      const record = byKey.get(key);
      if (record) {
        record.used += used;
        record.requests = (record.requests ?? 0) + requests;
        record.cacheHitTokens = (record.cacheHitTokens ?? 0) + cacheHit;
        record.cacheMissTokens = (record.cacheMissTokens ?? 0) + cacheMiss;
        record.responseTokens = (record.responseTokens ?? 0) + response;
      } else {
        byKey.set(key, {
          date,
          model: entry.model,
          used,
          requests,
          cacheHitTokens: cacheHit,
          cacheMissTokens: cacheMiss,
          responseTokens: response,
        });
      }
    }
  }
  return [...byKey.values()];
}

/** by_api_key/cost → 分模型逐日费用记录（含工具调用费用，跨 Key 合并） */
function parseCostBiz(biz: ByApiKeyCostBiz | undefined): ModelCostRecord[] {
  const group = biz?.data?.find(g => g.currency === 'CNY') ?? biz?.data?.[0];
  if (!group) return [];

  const byKey = new Map<string, ModelCostRecord>();
  for (const entry of [...(group.series ?? []), ...(group.function_series ?? [])]) {
    for (const b of entry.buckets ?? []) {
      const cost = parseFloat(b.cost) || 0;
      if (cost <= 0) continue;

      const date = bucketDate(b.time);
      const key = `${date}|${entry.model}`;
      const record = byKey.get(key);
      if (record) record.cost += cost;
      else byKey.set(key, { date, model: entry.model, cost });
    }
  }
  return [...byKey.values()];
}

/** by_api_key/amount 的 function_series → 工具逐日调用次数（跨 Key 合并） */
function parseToolCallBiz(biz: ByApiKeyAmountBiz | undefined): ToolCallRecord[] {
  const byKey = new Map<string, ToolCallRecord>();
  for (const entry of biz?.function_series ?? []) {
    for (const b of entry.buckets ?? []) {
      const count = Number(b.usage?.FUNCTION_CALL) || 0;
      if (count <= 0) continue;

      const date = bucketDate(b.time);
      const key = `${date}|${entry.model}`;
      const record = byKey.get(key);
      if (record) record.count += count;
      else byKey.set(key, { date, tool: entry.model, count });
    }
  }
  return [...byKey.values()];
}

/** amount 数据的 Token 总量（命中 + 未命中 + 输出） */
function sumAmountTokens(biz: ByApiKeyAmountBiz | undefined): number {
  let total = 0;
  for (const entry of biz?.series ?? []) {
    for (const b of entry.buckets ?? []) {
      total += (b.usage?.PROMPT_CACHE_HIT_TOKEN ?? 0)
        + (b.usage?.PROMPT_CACHE_MISS_TOKEN ?? 0)
        + (b.usage?.RESPONSE_TOKEN ?? 0);
    }
  }
  return total;
}

/** cost 数据的费用总额（含工具费用） */
function sumCostAmount(biz: ByApiKeyCostBiz | undefined): number {
  const group = biz?.data?.find(g => g.currency === 'CNY') ?? biz?.data?.[0];
  let total = 0;
  for (const entry of [...(group?.series ?? []), ...(group?.function_series ?? [])]) {
    for (const b of entry.buckets ?? []) {
      total += parseFloat(b.cost) || 0;
    }
  }
  return total;
}

export class DeepSeekProvider implements Provider {
  name = 'DeepSeek';

  private httpClient = new HttpClientWithRetry(3, 1000);

  async fetchUsage(config: ProviderConfig): Promise<UsageResult> {
    const mode = config.authMode || 'apikey';
    try {
      if (mode === 'weblogin') {
        return await this.fetchUsageWebLogin(config);
      }
      return await this.fetchUsageApiKey(config);
    } catch (error) {
      if (error instanceof Error && error.message === TOKEN_EXPIRED) {
        return {
          used: 0,
          total: 0,
          expiresAt: '',
          error: TOKEN_EXPIRED,
          details: { quotas: [] },
        };
      }
      throw error;
    }
  }

  private async fetchUsageApiKey(config: ProviderConfig): Promise<UsageResult> {
    const apiKey = config.apiKey?.trim();
    if (!apiKey) {
      throw new Error('[DeepSeek] API Key is required');
    }

    const baseUrl = (config._baseUrl as string) || 'https://api.deepseek.com';
    const url = `${baseUrl}/user/balance`;

    const resp = await this.httpClient.getJson<BalanceResponse>(url, {
      'Authorization': `Bearer ${apiKey}`,
    });

    if (!resp.is_available) {
      throw new Error('[DeepSeek] Account is not available');
    }

    const info = resp.balance_infos?.[0];
    if (!info) {
      throw new Error('[DeepSeek] No balance data returned');
    }

    const totalBalance = parseFloat(info.total_balance) || 0;
    const grantedBalance = parseFloat(info.granted_balance) || 0;
    const toppedUpBalance = parseFloat(info.topped_up_balance) || 0;
    const currency = info.currency || 'CNY';

    const quotas: QuotaItem[] = [];

    quotas.push({
      label: 'quota.deepseekTotalBalance',
      used: 0,
      total: totalBalance,
      usageRate: 0,
      resetAt: '',
      hideBar: true,
      labelParams: { amount: totalBalance.toFixed(2) },
      currency,
    });

    if (grantedBalance > 0) {
      quotas.push({
        label: 'quota.deepseekGranted',
        used: 0,
        total: grantedBalance,
        usageRate: 0,
        resetAt: '',
        hideBar: true,
        labelParams: { amount: grantedBalance.toFixed(2) },
        currency,
      });
    }

    if (toppedUpBalance > 0) {
      quotas.push({
        label: 'quota.deepseekToppedUp',
        used: 0,
        total: toppedUpBalance,
        usageRate: 0,
        resetAt: '',
        hideBar: true,
        labelParams: { amount: toppedUpBalance.toFixed(2) },
        currency,
      });
    }

    const serviceStatus = await fetchServiceStatus();

    return {
      used: 0,
      total: totalBalance,
      expiresAt: '',
      details: { quotas, serviceStatus, currency },
    };
  }

  private async fetchUsageWebLogin(config: ProviderConfig): Promise<UsageResult> {
    const token = config.webToken?.trim();
    if (!token) {
      throw new Error('[DeepSeek] Web token is required for weblogin mode');
    }

    const { headers, baseUrl } = this.webHeaders(config, token);
    const checkExpired = (code: number | undefined) => {
      if (code === 40002) throw new Error(TOKEN_EXPIRED);
    };

    const now = new Date();
    const { year, month } = currentMonthGmt8(now);
    const range = monthRangeGmt8(now, year, month);

    // 1. 用户概览（余额）；用量/费用失败时降级为仅余额展示
    const summaryResp = await this.httpClient.getJson<InternalApiData<UserSummaryBizData>>(
      `${baseUrl}/api/v0/users/get_user_summary`, headers
    );
    checkExpired(summaryResp.code);
    const summary = summaryResp.data?.biz_data;

    let amountBiz: ByApiKeyAmountBiz | undefined;
    let costBiz: ByApiKeyCostBiz | undefined;
    let toolCallHistory: ToolCallRecord[] = [];

    try {
      const [amountResp, costResp] = await Promise.all([
        this.httpClient.getJson<InternalApiData<ByApiKeyAmountBiz>>(
          `${baseUrl}/api/v0/usage/by_api_key/amount?start=${range.start}&end=${range.end}&tz=${DEEPSEEK_TZ_OFFSET}`, headers
        ),
        this.httpClient.getJson<InternalApiData<ByApiKeyCostBiz>>(
          `${baseUrl}/api/v0/usage/by_api_key/cost?start=${range.start}&end=${range.end}&tz=${DEEPSEEK_TZ_OFFSET}`, headers
        ),
      ]);
      checkExpired(amountResp.code);
      checkExpired(costResp.code);
      amountBiz = amountResp.data?.biz_data;
      costBiz = costResp.data?.biz_data;
      toolCallHistory = parseToolCallBiz(amountBiz);
    } catch (e) {
      if (e instanceof Error && e.message === TOKEN_EXPIRED) throw e;
      console.warn('[DeepSeek] Failed to fetch monthly usage:', e);
    }

    // 2. 汇总指标
    const totalBalance = summary ? parseFloat(summary.normal_wallets?.[0]?.balance || '0') : 0;
    const monthlyCost = sumCostAmount(costBiz);
    const monthlyTokens = sumAmountTokens(amountBiz);
    const currency = summary?.normal_wallets?.[0]?.currency
      ?? costBiz?.data?.[0]?.currency
      ?? 'CNY';

    const quotas: QuotaItem[] = [];
    quotas.push({
      label: 'quota.deepseekTotalBalance',
      used: 0,
      total: totalBalance,
      usageRate: 0,
      resetAt: '',
      hideBar: true,
      labelParams: { amount: totalBalance.toFixed(2) },
      currency,
    });

    if (monthlyCost > 0) {
      quotas.push({
        label: 'quota.deepseekMonthlyCost',
        used: 0,
        total: monthlyCost,
        usageRate: 0,
        resetAt: '',
        hideBar: true,
        labelParams: { amount: monthlyCost.toFixed(2) },
        currency,
      });
    }

    if (monthlyTokens > 0) {
      quotas.push({
        label: 'quota.deepseekMonthlyUsage',
        used: monthlyTokens,
        total: monthlyTokens,
        usageRate: 100,
        resetAt: '',
        hideBar: true,
        labelParams: { tokens: monthlyTokens.toLocaleString() },
      });
    }

    // 3. 本月逐日/分模型记录（渲染端当月图表直接使用）
    const modelHistory = parseAmountBiz(amountBiz);
    const modelCostHistory = parseCostBiz(costBiz);

    const historyByDate = new Map<string, number>();
    for (const r of modelHistory) {
      historyByDate.set(r.date, (historyByDate.get(r.date) ?? 0) + r.used);
    }
    const history30d = [...historyByDate.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, used]) => ({ date, used }));

    const serviceStatus = await fetchServiceStatus();

    return {
      used: 0,
      total: totalBalance,
      expiresAt: '',
      details: {
        quotas,
        history30d,
        totalTokens30d: monthlyTokens,
        estimatedCost30d: monthlyCost,
        modelHistory30d: modelHistory,
        modelCostHistory30d: modelCostHistory,
        toolCallHistory30d: toolCallHistory,
        serviceStatus,
        currency,
      },
    };
  }

  /** 按月获取模型 token 和费用历史（供 IPC 按需调用；GMT+8 口径） */
  async fetchMonthModelHistory(config: ProviderConfig, month: number, year: number): Promise<{
    tokens: import('../shared/types').ModelTokenRecord[];
    costs: ModelCostRecord[];
    toolCalls: ToolCallRecord[];
  }> {
    const token = config.webToken?.trim();
    if (!token) throw new Error('[DeepSeek] Web token is required');

    const { headers, baseUrl } = this.webHeaders(config, token);
    const range = monthRangeGmt8(new Date(), year, month);

    const [amountResp, costResp] = await Promise.all([
      this.httpClient.getJson<InternalApiData<ByApiKeyAmountBiz>>(
        `${baseUrl}/api/v0/usage/by_api_key/amount?start=${range.start}&end=${range.end}&tz=${DEEPSEEK_TZ_OFFSET}`, headers
      ),
      this.httpClient.getJson<InternalApiData<ByApiKeyCostBiz>>(
        `${baseUrl}/api/v0/usage/by_api_key/cost?start=${range.start}&end=${range.end}&tz=${DEEPSEEK_TZ_OFFSET}`, headers
      ),
    ]);
    if (amountResp.code === 40002 || costResp.code === 40002) throw new Error(TOKEN_EXPIRED);

    return {
      tokens: parseAmountBiz(amountResp.data?.biz_data),
      costs: parseCostBiz(costResp.data?.biz_data),
      toolCalls: parseToolCallBiz(amountResp.data?.biz_data),
    };
  }

  private webHeaders(config: ProviderConfig, token: string): { headers: Record<string, string>; baseUrl: string } {
    const baseUrl = 'https://platform.deepseek.com';
    const userAgent = config.webUserAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36';
    return {
      baseUrl,
      headers: {
        'Authorization': `Bearer ${token}`,
        'User-Agent': userAgent,
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Referer': 'https://platform.deepseek.com/usage',
        'Origin': 'https://platform.deepseek.com',
      },
    };
  }
}
