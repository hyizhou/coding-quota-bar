/**
 * StepFun（阶跃星辰）Provider：读取 platform.stepfun.com 网页会话的 Step Plan 订阅额度。
 * 双模式凭据：session（弹窗登录，persist:stepfun-{accountId} 持久化 Cookie，隐藏窗口页内 fetch）
 * 与 manual（设置页粘贴 Oasis-Token 裸 JWT，主进程 HttpClient 直连）。
 * 数据源与字段口径：docs/stepfun/阶跃星辰plan查询指南.md
 */
import { BrowserWindow } from 'electron';
import { HttpClient } from '../main/http';
import type { ModelTokenRecord, Provider, ProviderConfig, QuotaItem, StepFunCreditAmounts, StepFunTopupBucket, UsageResult } from '../shared/types';
import { createLoadedWindow, execInPage, waitForReload } from './page-fetch';

const TOKEN_EXPIRED = 'TOKEN_EXPIRED';

const BASE_URL = 'https://platform.stepfun.com';
const ACCOUNT_PAGE = `${BASE_URL}/account-overview`;
const RATE_LIMIT_PATH = '/api/step.openapi.devcenter.Dashboard/QueryStepPlanRateLimit';
const PLAN_STATUS_PATH = '/api/step.openapi.devcenter.Dashboard/GetStepPlanStatus';
const BALANCE_PATH = '/api/step.openapi.devcenter.Dashboard/QueryAccountBalance';
const USAGES_PATH = '/api/step.openapi.devcenter.Dashboard/QueryStepPlanUsages';

/** 请求/页面加载超时（接入指南 §3：建议 15 秒） */
const REQUEST_TIMEOUT = 15000;
/** 用量明细分页参数（7/30 天按小时×模型聚合足够覆盖） */
const USAGES_PAGE_SIZE = 200;
const USAGES_MAX_RECORDS = 2000;

/** 鉴权失败判定（接入指南 §9）：HTTP 状态 + 错误消息关键字 */
const AUTH_FAIL_PATTERN = /unauthorized|unauthenticated|invalid credentials|invalid token|token expired|expired token|embezzled/i;

/** ---------- 基础类型与解析 ---------- */

interface StepFunCreditBucket {
  type: number;
  total: number;
  residual: number;
  expireAt: string;
  nextResetAt: string;
}

interface StepFunUsageItem {
  fromTime: number;
  modelId: string;
  calls: number;
  creditConsumed: number;
}

/** 单个 API 调用器：session（页内 fetch）与 manual（HttpClient）各提供一个实现 */
type StepFunCaller = (path: string, body: Record<string, unknown>) => Promise<{ status: number; body: string }>;

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function errorResult(error: string): UsageResult {
  return { used: 0, total: 0, expiresAt: '', error, details: { quotas: [] } };
}

function isAuthFailure(status: number, body: string): boolean {
  if (status === 401 || status === 403) return true;
  return AUTH_FAIL_PATTERN.test(body);
}

/** int/float/string 三类型兼容取数（接入指南 §5 类型容错要求） */
function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Unix 秒级时间戳（字符串/整数兼容）→ ISO 8601；非正数返回空串表示无有效时间 */
function secondsToIso(value: unknown): string {
  const n = toNumber(value);
  if (n == null || n <= 0) return '';
  return new Date(n * 1000).toISOString();
}

/** 剩余比例 → 已用百分比（0-100，容错夹取） */
function leftRateToUsedPercent(rate: unknown): number | null {
  const n = toNumber(rate);
  if (n == null) return null;
  return Math.min(100, Math.max(0, (1 - n) * 100));
}

/** 分 → 元（数值，用于订阅价格） */
function fenToYuan(value: unknown): number {
  const n = toNumber(value);
  return n == null ? 0 : Math.round(n) / 100;
}

/** 分 → 元（字符串，用于余额展示，保留两位小数） */
function fenToYuanString(value: unknown): string {
  const n = toNumber(value);
  return n == null ? '0.00' : (n / 100).toFixed(2);
}

/**
 * 从 Oasis-Token 推导 Oasis-Webid（接入指南 §2 防伪点）：
 * 组合对优先取 refresh 半段的 device_id，取不到再取 access 半段；裸 JWT 取自身。
 */
export function parseStepFunWebid(token: string): string {
  const raw = token.trim();
  if (!raw) return '';
  const segments = raw.split('...');
  const candidates = segments.length > 1 ? [segments[1], segments[0]] : [raw];
  for (const candidate of candidates) {
    const parts = candidate.split('.');
    if (parts.length !== 3) continue;
    try {
      let b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      while (b64.length % 4 !== 0) b64 += '=';
      const payload = JSON.parse(Buffer.from(b64, 'base64').toString('utf-8')) as Record<string, unknown>;
      if (typeof payload.device_id === 'string' && payload.device_id) return payload.device_id;
    } catch {
      // 尝试下一个候选
    }
  }
  return '';
}

/** ---------- session 模式：隐藏窗口页内 fetch（Cookie 自动携带，webid 头传空串由服务端回退匹配） ---------- */

async function callInPage(win: BrowserWindow, path: string, body: Record<string, unknown>): Promise<{ status: number; body: string }> {
  // 脚本返回 JSON.stringify 后的字符串，必须 parse 还原 {status, body}
  const json = await execInPage<string>(win, `
    (function() {
      return fetch('${path}', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'oasis-appid': '10300',
          'oasis-platform': 'web',
          'oasis-webid': ''
        },
        body: ${JSON.stringify(JSON.stringify(body))}
      }).then(function(r) {
        return r.text().then(function(t) { return JSON.stringify({ status: r.status, body: t }); });
      });
    })()
  `);
  return JSON.parse(json) as { status: number; body: string };
}

/** ---------- manual 模式：主进程直连（Cookie 与 webid 头都写真实 device_id） ---------- */

function createHttpCaller(token: string, webid: string): StepFunCaller {
  return async (path, body) => {
    const resp = await HttpClient.request(`${BASE_URL}${path}`, {
      method: 'POST',
      timeout: REQUEST_TIMEOUT,
      headers: {
        'Content-Type': 'application/json',
        'connect-protocol-version': '1',
        'oasis-appid': '10300',
        'oasis-platform': 'web',
        'oasis-webid': webid,
        'Cookie': `Oasis-Token=${token}; Oasis-Webid=${webid}`,
      },
      body: JSON.stringify(body ?? {}),
    });
    return { status: resp.status, body: resp.body };
  };
}

/** ---------- 用量明细（按小时 × 模型，接入指南 §8） ---------- */

function parseUsageItem(raw: unknown): StepFunUsageItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  const fromTime = toNumber(record.from_time);
  const modelId = typeof record.model_id === 'string' ? record.model_id : '';
  const calls = toNumber(record.calls) ?? 0;
  const creditConsumed = toNumber(record.credit_consumed) ?? 0;
  if (fromTime == null || fromTime <= 0 || !modelId) return null;
  return { fromTime, modelId, calls, creditConsumed };
}

async function fetchUsageItems(caller: StepFunCaller, days: number): Promise<StepFunUsageItem[]> {
  const now = Date.now();
  const start = now - days * 86400000;
  const items: StepFunUsageItem[] = [];
  let page = 1;

  while (items.length < USAGES_MAX_RECORDS) {
    const { status, body } = await caller(USAGES_PATH, {
      startTime: String(start),
      toTime: String(now),
      page,
      pageSize: USAGES_PAGE_SIZE,
      granularHour: 1,
    });
    // fail-soft：用量明细失败不影响额度数据
    if (status < 200 || status >= 300) break;

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(body) as Record<string, unknown>;
    } catch {
      break;
    }
    const records = Array.isArray(parsed.records) ? parsed.records : [];
    for (const raw of records) {
      const item = parseUsageItem(raw);
      if (item) items.push(item);
    }
    const total = toNumber(parsed.total) ?? 0;
    if (records.length === 0 || items.length >= total) break;
    page++;
  }

  return items;
}

function usageItemsToRecords(items: StepFunUsageItem[]): ModelTokenRecord[] {
  return items
    .map(item => ({
      // 小时粒度键 'YYYY-MM-DDTHH'（本地时区，渲染端图表按本地小时聚合桶键匹配）
      date: formatLocalHour(new Date(item.fromTime)),
      model: item.modelId,
      used: item.creditConsumed,
      requests: item.calls,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function formatLocalHour(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}`;
}

/** 本地日期字符串 YYYY-MM-DD（订阅卡片/浮窗展示用，去除时分秒噪音） */
function formatLocalDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** ---------- 数据映射 ---------- */

interface StepFunPlanSnapshot {
  quotas: QuotaItem[];
  mainUsed: number;
  mainTotal: number;
  topupBuckets: StepFunTopupBucket[];
  creditAmounts?: StepFunCreditAmounts;
}

/** PlanCreditBucket.Type 枚举：0=UNSPECIFIED, 1=SUBSCRIPTION(订阅), 2=TOPUP(加油包) */
const SUBSCRIPTION_BUCKET_TYPE = 1;
const TOPUP_BUCKET_TYPE = 2;

/**
 * 额度解析（接入指南 §5）：
 * 套餐形态按响应实际形状判定（任一窗口 reset_time > 0 → 窗口型；否则有积分形状 → 积分型），
 * 不做单点 plan_family 判断。
 */
function parseRateLimit(body: string): StepFunPlanSnapshot {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(body) as Record<string, unknown>;
  } catch {
    throw new Error('PARSE_FAILED: invalid JSON');
  }
  if (toNumber(parsed.status) !== 1) {
    const msg = typeof parsed.message === 'string' && parsed.message
      ? parsed.message
      : (typeof parsed.desc === 'string' ? parsed.desc : '') || `status ${String(parsed.status)}`;
    throw new Error(`API_ERROR: ${msg}`);
  }

  const fiveHourReset = toNumber(parsed.five_hour_usage_reset_time) ?? 0;
  const weeklyReset = toNumber(parsed.weekly_usage_reset_time) ?? 0;
  const credit = (parsed.plan_credit_rate_limit && typeof parsed.plan_credit_rate_limit === 'object')
    ? parsed.plan_credit_rate_limit as Record<string, unknown>
    : null;
  const hasCreditShape = !!credit && (
    toNumber(credit.subscription_credit_left_rate) != null
    || toNumber(credit.topup_credit_left_rate) != null
    || (Array.isArray(credit.credit_buckets) && credit.credit_buckets.length > 0)
  );

  // 速率窗口型：有活跃窗口，四个速率/重置字段必须齐全
  if (fiveHourReset > 0 || weeklyReset > 0) {
    const fiveHourUsed = leftRateToUsedPercent(parsed.five_hour_usage_left_rate);
    const weeklyUsed = leftRateToUsedPercent(parsed.weekly_usage_left_rate);
    if (fiveHourUsed == null || weeklyUsed == null) {
      throw new Error('PARSE_FAILED: rate window fields missing');
    }
    return {
      quotas: [
        { label: 'quota.stepfun5hWindow', used: fiveHourUsed, total: 100, usageRate: fiveHourUsed, resetAt: secondsToIso(fiveHourReset), displayUnit: 'percent', limitType: 'stepfun-5h' },
        { label: 'quota.stepfunWeeklyWindow', used: weeklyUsed, total: 100, usageRate: weeklyUsed, resetAt: secondsToIso(weeklyReset), displayUnit: 'percent', limitType: 'stepfun-weekly' },
      ],
      mainUsed: Math.max(fiveHourUsed, weeklyUsed),
      mainTotal: 100,
      topupBuckets: [],
    };
  }

  // 积分型（新套餐尚未产生数据时以 plan_family == 2 兜底）
  if (hasCreditShape || toNumber(parsed.plan_family) === 2) {
    const buckets: StepFunCreditBucket[] = [];
    const rawBuckets = credit && Array.isArray(credit.credit_buckets) ? credit.credit_buckets : [];
    let allBucketsValid = rawBuckets.length > 0;
    for (const raw of rawBuckets) {
      if (!raw || typeof raw !== 'object') { allBucketsValid = false; break; }
      const bucket = raw as Record<string, unknown>;
      const total = toNumber(bucket.credit_total);
      const residual = toNumber(bucket.credit_residual);
      if (total == null || residual == null || total <= 0 || residual < 0 || residual > total) {
        allBucketsValid = false;
        break;
      }
      buckets.push({
        type: toNumber(bucket.type) ?? 0,
        total,
        residual,
        expireAt: secondsToIso(bucket.expire_at),
        nextResetAt: secondsToIso(bucket.next_reset_at),
      });
    }

    // 总额度卡取响应的 subscription_credit_left_rate（官方页「Credit用量」同款字段）；
    // 订阅比例缺失时依次退回 Σ桶比例 → 充值比例
    let remaining: number | null = null;
    const subscriptionRate = credit ? toNumber(credit.subscription_credit_left_rate) : null;
    if (subscriptionRate != null) {
      remaining = subscriptionRate;
    } else if (allBucketsValid && buckets.length > 0) {
      const totalSum = buckets.reduce((sum, b) => sum + b.total, 0);
      const residualSum = buckets.reduce((sum, b) => sum + b.residual, 0);
      if (totalSum > 0) remaining = residualSum / totalSum;
    } else {
      const topup = credit ? toNumber(credit.topup_credit_left_rate) : null;
      if (topup != null) remaining = topup;
    }

    if (remaining == null) {
      // 新套餐尚未产生数据：无额度项，托盘按充足处理
      return { quotas: [], mainUsed: 0, mainTotal: 0, topupBuckets: [] };
    }
    const used = Math.min(100, Math.max(0, (1 - remaining) * 100));
    const quotas: QuotaItem[] = [{
        label: 'quota.stepfunCredits',
        used,
        total: 100,
        usageRate: used,
        resetAt: credit ? secondsToIso(credit.subscription_credit_reset_time) : '',
        displayUnit: 'percent',
        limitType: 'stepfun-credits',
    }];

    // 加油包桶单独下发（对齐官方：仅 TYPE_TOPUP 桶展示为加油包；
    // 订阅桶的量经 subscription_credit_left_rate 与 creditAmounts 下发）
    const topupBuckets = buckets
      .filter(b => b.type === TOPUP_BUCKET_TYPE)
      .map(b => ({ total: b.total, residual: b.residual, expireAt: b.expireAt }));

    // 订阅桶（type=1）的绝对量：供 Credit 总卡显示具体用量数值；订阅桶缺失时不显示数值
    const subscriptionBucket = buckets.find(b => b.type === SUBSCRIPTION_BUCKET_TYPE);
    const creditAmounts = subscriptionBucket
      ? { total: subscriptionBucket.total, residual: subscriptionBucket.residual }
      : undefined;

    return { quotas, mainUsed: used, mainTotal: 100, topupBuckets, creditAmounts };
  }

  // 无法判定套餐形态：不渲染额度，避免误报已用尽
  return { quotas: [], mainUsed: 0, mainTotal: 0, topupBuckets: [] };
}

function parseSubscription(body: string | null): {
  level: string;
  expiresAt: string;
  subscription: import('../shared/types').SubscriptionInfo;
} | null {
  if (!body) return null;
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    if (toNumber(parsed.status) !== 1) return null;
    const sub = parsed.subscription;
    if (!sub || typeof sub !== 'object') return null;
    const subscription = sub as Record<string, unknown>;
    const def = (parsed.plan_definition && typeof parsed.plan_definition === 'object')
      ? parsed.plan_definition as Record<string, unknown>
      : {};

    const level = typeof subscription.name === 'string' ? subscription.name : '';
    const durationDays = toNumber(def.duration_days) ?? 0;
    const billingCycle = durationDays >= 360 ? 'yearly' : durationDays >= 28 && durationDays <= 31 ? 'monthly' : (durationDays > 0 ? `${durationDays}d` : '');
    const activatedAt = toNumber(subscription.activated_at) ?? 0;
    const expiredAt = toNumber(subscription.expired_at) ?? 0;
    return {
      level,
      expiresAt: secondsToIso(subscription.expired_at),
      subscription: {
        plan: level,
        status: toNumber(subscription.status) === 1 ? 'VALID' : 'EXPIRED',
        currentRenewTime: activatedAt > 0 ? formatLocalDate(new Date(activatedAt * 1000)) : '',
        nextRenewTime: expiredAt > 0 ? formatLocalDate(new Date(expiredAt * 1000)) : '',
        autoRenew: subscription.auto_renew === true,
        actualPrice: fenToYuan(def.price),
        renewPrice: fenToYuan(def.original_price),
        billingCycle,
      },
    };
  } catch {
    return null;
  }
}

function parseBalance(body: string | null): { total: string; gift: string; cash: string; frozen: string; currency: string } | null {
  if (!body) return null;
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      total: fenToYuanString(parsed.balance),
      gift: fenToYuanString(parsed.voucher),
      cash: fenToYuanString(parsed.payment),
      frozen: '0.00',
      currency: 'CNY',
    };
  } catch {
    return null;
  }
}

function buildUsageResult(
  snapshot: StepFunPlanSnapshot,
  planStatus: ReturnType<typeof parseSubscription>,
  balance: ReturnType<typeof parseBalance>,
  usageItems: StepFunUsageItem[],
): UsageResult {
  const modelHistory7d = usageItemsToRecords(usageItems);

  // 按小时聚合 Credits 总量（history7d 供用量摘要使用）
  const hourlyMap = new Map<string, number>();
  for (const record of modelHistory7d) {
    hourlyMap.set(record.date, (hourlyMap.get(record.date) ?? 0) + record.used);
  }
  const history7d = Array.from(hourlyMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, used]) => ({ date, used }));

  const details: Record<string, unknown> = {
    quotas: snapshot.quotas,
    modelHistory7d,
    history7d,
  };
  if (planStatus) details.subscription = planStatus.subscription;
  if (balance) details.balance = balance;
  if (snapshot.topupBuckets.length > 0) details.stepfunTopupBuckets = snapshot.topupBuckets;
  if (snapshot.creditAmounts) details.stepfunCreditAmounts = snapshot.creditAmounts;

  return {
    used: snapshot.mainUsed,
    total: snapshot.mainTotal,
    expiresAt: planStatus?.expiresAt ?? '',
    level: planStatus?.level || undefined,
    details,
  };
}

/** ---------- Provider ---------- */

export class StepFunProvider implements Provider {
  name = 'StepFun';

  /** 用量历史缓存 key: "accountId:days:YYYY-MM-DD"（日级缓存，跨日自动失效） */
  private historyCache = new Map<string, ModelTokenRecord[]>();

  /** session 模式：创建临时隐藏窗口执行页内请求，结束后销毁窗口（供主额度与历史查询复用） */
  private async withSessionWindow<T>(accountId: string, fn: (win: BrowserWindow, caller: StepFunCaller) => Promise<T>): Promise<T> {
    let win: BrowserWindow | null = null;
    try {
      win = await createLoadedWindow({ partition: `persist:stepfun-${accountId}`, url: ACCOUNT_PAGE });
      const caller: StepFunCaller = (path, body) => callInPage(win!, path, body);
      return await fn(win, caller);
    } finally {
      if (win && !win.isDestroyed()) win.destroy();
    }
  }

  async fetchUsage(config: ProviderConfig): Promise<UsageResult> {
    if (config.stepfunCookieSource === 'manual') return this.fetchViaHttp(config);
    return this.fetchViaSession(config.accountId ?? '');
  }

  /** manual 模式：裸 Oasis-Token 直连（无 refresh 半段，过期需用户重新粘贴） */
  private async fetchViaHttp(config: ProviderConfig): Promise<UsageResult> {
    const token = (config.webToken ?? '').trim();
    const webid = parseStepFunWebid(token);
    // Token 为空或无法推导 device_id 均视为无效 Token
    if (!token || !webid) return errorResult(TOKEN_EXPIRED);

    const caller = createHttpCaller(token, webid);
    try {
      const rateResp = await caller(RATE_LIMIT_PATH, {});
      if (isAuthFailure(rateResp.status, rateResp.body)) return errorResult(TOKEN_EXPIRED);
      if (rateResp.status < 200 || rateResp.status >= 300) return errorResult(`HTTP ${rateResp.status}`);
      return await this.collectAndTransform(caller, rateResp.body);
    } catch (e) {
      return errorResult(`NETWORK_ERROR: ${errorMessage(e)}`);
    }
  }

  /** session 模式：临时隐藏窗口页内 fetch，鉴权失败时 reload 重试一次 */
  private async fetchViaSession(accountId: string): Promise<UsageResult> {
    try {
      return await this.withSessionWindow(accountId, async (win, caller) => {
        let rateResp = await caller(RATE_LIMIT_PATH, {});
        if (isAuthFailure(rateResp.status, rateResp.body)) {
          console.log(`[StepFun] Session expired for ${accountId}, reloading...`);
          await waitForReload(win);
          rateResp = await caller(RATE_LIMIT_PATH, {});
        }
        if (isAuthFailure(rateResp.status, rateResp.body)) return errorResult(TOKEN_EXPIRED);
        if (rateResp.status < 200 || rateResp.status >= 300) return errorResult(`HTTP ${rateResp.status}`);

        return await this.collectAndTransform(caller, rateResp.body);
      });
    } catch (e) {
      return errorResult(`NETWORK_ERROR: ${errorMessage(e)}`);
    }
  }

  /** 主额度成功后拉取附属数据（套餐/余额/用量明细均 fail-soft）并组装结果 */
  private async collectAndTransform(caller: StepFunCaller, rateLimitBody: string): Promise<UsageResult> {
    const [planStatusBody, balanceBody, usageItems] = await Promise.all([
      caller(PLAN_STATUS_PATH, {}).then(r => (r.status >= 200 && r.status < 300 && !isAuthFailure(r.status, r.body)) ? r.body : null).catch(() => null),
      caller(BALANCE_PATH, {}).then(r => (r.status >= 200 && r.status < 300 && !isAuthFailure(r.status, r.body)) ? r.body : null).catch(() => null),
      fetchUsageItems(caller, 7).catch(() => [] as StepFunUsageItem[]),
    ]);

    const snapshot = parseRateLimit(rateLimitBody);
    return buildUsageResult(snapshot, parseSubscription(planStatusBody), parseBalance(balanceBody), usageItems);
  }

  /** 按需获取用量历史（供 IPC 调用 7/30 天），带日级缓存 */
  async fetchModelHistory(config: ProviderConfig, days: 7 | 30): Promise<ModelTokenRecord[]> {
    const key = `${config.accountId ?? ''}:${days}:${new Date().toISOString().slice(0, 10)}`;
    const cached = this.historyCache.get(key);
    if (cached) return cached;

    const records = await this.fetchHistoryRecords(config, days);
    this.historyCache.set(key, records);
    return records;
  }

  private async fetchHistoryRecords(config: ProviderConfig, days: 7 | 30): Promise<ModelTokenRecord[]> {
    try {
      if (config.stepfunCookieSource === 'manual') {
        const token = (config.webToken ?? '').trim();
        const webid = parseStepFunWebid(token);
        if (!token || !webid) return [];
        return usageItemsToRecords(await fetchUsageItems(createHttpCaller(token, webid), days));
      }

      return await this.withSessionWindow(config.accountId ?? '', async (_win, caller) =>
        usageItemsToRecords(await fetchUsageItems(caller, days)));
    } catch {
      return [];
    }
  }
}
