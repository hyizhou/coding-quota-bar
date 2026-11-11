/**
 * 千问 / 阿里云百炼 Token Plan 协议层（纯函数，无 Electron 依赖）
 *
 * 用量来自百炼控制台 CLI 网关（官方 bailian-cli `bl usage token-plan` 同款接口），
 * 鉴权为控制台 access token（console-login 回传），Token Plan 的 sk-sp- Key 无法查询用量。
 * 协议细节见 api-docs/qwen/QWEN_TOKEN_PLAN_API.md。
 */
import type { QuotaItem, QwenSubscription } from '../shared/types';

export type { QwenSubscription };

/** 站点：国内站（百炼）/ 国际站（Model Studio），账号互不相通 */
export type QwenRegion = 'cn' | 'global';

export interface QwenSiteInfo {
  /** 控制台 origin：console-login 登录页所在站点，也是回传凭证请求的 Origin */
  consoleOrigin: string;
  /** CLI 网关 host */
  gatewayHost: string;
  /** 网关 action 参数 */
  gatewayAction: string;
  /** 网关 region 参数 */
  gatewayRegion: string;
}

export const QWEN_SITES: Record<QwenRegion, QwenSiteInfo> = {
  cn: {
    consoleOrigin: 'https://bailian.console.aliyun.com',
    gatewayHost: 'bailian-cs.console.aliyun.com',
    gatewayAction: 'BroadScopeAspnGateway',
    gatewayRegion: 'cn-beijing',
  },
  global: {
    consoleOrigin: 'https://modelstudio.console.alibabacloud.com',
    gatewayHost: 'bailian-singapore-cs.alibabacloud.com',
    gatewayAction: 'IntlBroadScopeAspnGateway',
    gatewayRegion: 'ap-southeast-1',
  },
};

export function qwenSite(region: unknown): QwenSiteInfo {
  return QWEN_SITES[region === 'global' ? 'global' : 'cn'];
}

/** 网关 API 名（zeldaHttp.apikeyMgr 前缀 + Token Plan 个人版 v2 路径） */
export const QWEN_API = {
  usage: 'zeldaHttp.apikeyMgr./tokenplan/personal/api/v2/usage',
  subscription: 'zeldaHttp.apikeyMgr./tokenplan/personal/api/v2/subscription',
  quotaConfig: 'zeldaHttp.apikeyMgr./tokenplan/personal/api/v2/quota-config',
} as const;

/** 网关会话失效错误码（未登录 / token 过期 / token 无效均返回此码） */
export const QWEN_NOT_LOGINED = 'NotLogined';

export interface QwenGatewayRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
}

/** 构造网关请求：form 表单 params（JSON 字符串）+ region，access token 走 Bearer */
export function buildGatewayRequest(region: unknown, api: string, accessToken: string): QwenGatewayRequest {
  const site = qwenSite(region);
  const params = JSON.stringify({
    Api: api,
    V: '1.0',
    Data: {
      cornerstoneParam: {
        protocol: 'V2',
        console: 'ONE_CONSOLE',
        productCode: 'p_efm',
        switchUserType: 3,
        consoleSite: 'BAILIAN_ALIYUN',
      },
    },
  });
  const body = new URLSearchParams({ params, region: site.gatewayRegion }).toString();
  return {
    url: `https://${site.gatewayHost}/cli/api.json?action=${site.gatewayAction}&product=sfm_bailian&api=${encodeURIComponent(api)}`,
    headers: {
      'Accept': '*/*',
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Bearer ${accessToken}`,
    },
    body,
  };
}

export type QwenGatewayResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; expired: boolean; error: string };

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/**
 * 解析网关响应：外层 data.success=false 带 errorCode（NotLogined 视为会话失效），
 * 成功时业务数据位于 data.DataV2.data.data（业务层 success=false 同样视为失败）
 */
export function parseGatewayResponse(body: string): QwenGatewayResult {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return { ok: false, expired: false, error: 'Invalid gateway response' };
  }
  const outer = isRecord(json) && isRecord(json.data) ? json.data : null;
  if (!outer) return { ok: false, expired: false, error: 'Invalid gateway response' };

  if (outer.success === false) {
    const code = typeof outer.errorCode === 'string' ? outer.errorCode : JSON.stringify(outer.errorCode ?? '');
    if (code.includes(QWEN_NOT_LOGINED)) return { ok: false, expired: true, error: code };
    const msg = typeof outer.errorMsg === 'string' && outer.errorMsg ? outer.errorMsg : code;
    return { ok: false, expired: false, error: msg || 'Gateway error' };
  }

  const biz = isRecord(outer.DataV2) && isRecord(outer.DataV2.data) ? outer.DataV2.data : null;
  if (!biz) return { ok: false, expired: false, error: 'Invalid gateway response' };
  if (biz.success === false) {
    const msg = typeof biz.msg === 'string' && biz.msg ? biz.msg : String(biz.code ?? 'Request failed');
    return { ok: false, expired: false, error: msg };
  }
  return { ok: true, data: isRecord(biz.data) ? biz.data : {} };
}

/** 单个用量窗口：per{N}{Hour|Day|Week|Month}Percentage / ResetTime */
export interface QwenUsageWindow {
  /** 窗口键，如 per1Month、per5Hour */
  key: string;
  count: number;
  unit: 'Hour' | 'Day' | 'Week' | 'Month';
  /** 已用比例 0~1 */
  percentage?: number;
  /** 重置时间 epoch ms */
  resetTime?: number;
}

const WINDOW_RE = /^per(\d+)(Hour|Day|Week|Month)(Percentage|ResetTime)$/;
const UNIT_HOURS: Record<QwenUsageWindow['unit'], number> = { Hour: 1, Day: 24, Week: 168, Month: 720 };

function toFiniteNumber(v: unknown): number | undefined {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : undefined;
}

/** 按字段名模式解析全部窗口（与官方 CLI 一致），按窗口时长升序 */
export function parseUsageWindows(data: Record<string, unknown>): QwenUsageWindow[] {
  const map = new Map<string, QwenUsageWindow>();
  for (const [field, raw] of Object.entries(data)) {
    const m = WINDOW_RE.exec(field);
    if (!m) continue;
    const value = toFiniteNumber(raw);
    if (value === undefined) continue;
    const [, count, unit, kind] = m;
    const key = `per${count}${unit}`;
    const w = map.get(key) ?? { key, count: Number(count), unit: unit as QwenUsageWindow['unit'] };
    if (kind === 'Percentage') w.percentage = value;
    else w.resetTime = value;
    map.set(key, w);
  }
  return [...map.values()].sort((a, b) => a.count * UNIT_HOURS[a.unit] - b.count * UNIT_HOURS[b.unit]);
}

function epochMsToIso(v: unknown): string {
  const n = toFiniteNumber(v);
  return n !== undefined && n > 0 ? new Date(n).toISOString() : '';
}

export function parseSubscription(data: Record<string, unknown>): QwenSubscription | null {
  const specCode = typeof data.specCode === 'string' ? data.specCode : '';
  if (!specCode) return null;
  return {
    specCode,
    status: typeof data.status === 'string' ? data.status : '',
    startAt: epochMsToIso(data.startTime),
    endAt: epochMsToIso(data.endTime),
    remainingDays: toFiniteNumber(data.remainingDays),
    autoRenew: data.autoRenewFlag === true,
  };
}

/** 套餐额度配置：{ specCode: { five_hour, monthly, ... } }，单位 Credits */
export type QwenQuotaConfig = Record<string, Record<string, number>>;

export function parseQuotaConfig(data: Record<string, unknown>): QwenQuotaConfig {
  const result: QwenQuotaConfig = {};
  for (const [spec, raw] of Object.entries(data)) {
    if (!isRecord(raw)) continue;
    const limits: Record<string, number> = {};
    for (const [k, v] of Object.entries(raw)) {
      const n = toFiniteNumber(v);
      if (n !== undefined) limits[k] = n;
    }
    result[spec] = limits;
  }
  return result;
}

/** 窗口 → quota-config 中的额度字段名（未知窗口无总额，仅展示百分比） */
function quotaConfigKey(w: QwenUsageWindow): string | null {
  if (w.count === 5 && w.unit === 'Hour') return 'five_hour';
  if (w.count === 1 && w.unit === 'Week') return 'weekly';
  if (w.count === 1 && w.unit === 'Month') return 'monthly';
  return null;
}

/** 窗口 → i18n 标签与 limitType */
function windowLabel(w: QwenUsageWindow): { label: string; limitType: string; labelParams?: Record<string, string | number> } {
  if (w.count === 5 && w.unit === 'Hour') return { label: 'quota.qwen5h', limitType: '5h' };
  if (w.count === 1 && w.unit === 'Week') return { label: 'quota.qwenWeekly', limitType: 'weekly' };
  if (w.count === 1 && w.unit === 'Month') return { label: 'quota.qwenMonthly', limitType: 'monthly' };
  return { label: 'quota.qwenWindow', limitType: w.key, labelParams: { n: w.count, unit: w.unit.toLowerCase() } };
}

/**
 * 用量窗口 → QuotaItem：used/total 统一为百分比口径（0~100），
 * 已知套餐总额时在 labelParams 附带 Credits 绝对量（usedCredits / totalCredits）
 */
export function buildQuotaItems(
  windows: QwenUsageWindow[],
  subscription: QwenSubscription | null,
  quotaConfig: QwenQuotaConfig | null,
): QuotaItem[] {
  const limits = subscription && quotaConfig ? quotaConfig[subscription.specCode] : undefined;
  const items: QuotaItem[] = [];
  for (const w of windows) {
    if (w.percentage === undefined) continue;
    const rate = Math.max(0, Math.min(100, w.percentage * 100));
    const { label, limitType, labelParams } = windowLabel(w);
    const cfgKey = quotaConfigKey(w);
    const totalCredits = cfgKey && limits ? limits[cfgKey] : undefined;
    const params: Record<string, string | number> = { ...(labelParams ?? {}) };
    if (totalCredits && totalCredits > 0) {
      params.totalCredits = totalCredits;
      params.usedCredits = Math.round(w.percentage * totalCredits);
    }
    items.push({
      label,
      ...(Object.keys(params).length > 0 ? { labelParams: params } : {}),
      used: rate,
      total: 100,
      usageRate: rate,
      resetAt: epochMsToIso(w.resetTime),
      limitType,
      displayUnit: 'percent',
    });
  }
  return items;
}

/** 套餐规格展示名：standard → Standard */
export function formatSpecCode(specCode: string): string {
  return specCode ? specCode.charAt(0).toUpperCase() + specCode.slice(1) : '';
}

/**
 * 从 console-login 回传请求中提取 access token：
 * 依次尝试 URL 查询参数、JSON、x-www-form-urlencoded、multipart/form-data
 * （与官方 CLI 的本地回调服务兼容的格式一致）
 */
export function extractAccessToken(query: URLSearchParams, body: string, contentType: string): string | null {
  const pick = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const fromQuery = pick(query.get('access_token')) ?? pick(query.get('accessToken'));
  if (fromQuery) return fromQuery;
  const text = body.replace(/^﻿/, '').trim();
  if (!text) return null;

  const ct = contentType.toLowerCase();
  const multipart = /boundary=("?)([^";]+)\1/i.exec(contentType);
  if (ct.includes('multipart/form-data') && multipart) {
    for (const part of text.split(`--${multipart[2]}`)) {
      if (!/name\s*=\s*["'](?:access_token|accessToken)["']/i.test(part)) continue;
      const idx = part.search(/\r?\n\r?\n/);
      if (idx < 0) continue;
      const value = pick(part.slice(idx).replace(/^\r?\n\r?\n/, '').replace(/[\r\n-]+$/, ''));
      if (value) return value;
    }
  }

  try {
    const json: unknown = JSON.parse(text);
    if (isRecord(json)) {
      const direct = pick(json.access_token) ?? pick(json.accessToken);
      if (direct) return direct;
      if (isRecord(json.data)) {
        const nested = pick(json.data.access_token) ?? pick(json.data.accessToken);
        if (nested) return nested;
      }
    }
  } catch {
    // 非 JSON，继续尝试表单
  }

  try {
    const form = new URLSearchParams(text);
    return pick(form.get('access_token')) ?? pick(form.get('accessToken'));
  } catch {
    return null;
  }
}
