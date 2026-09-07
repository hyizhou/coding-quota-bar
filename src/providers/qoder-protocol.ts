/**
 * Qoder 协议纯函数模块：站点模型、手动捕获解析（cURL/HTTP/Cookie 头）、
 * 用量响应解析与额度合并。规范来源：docs/qoder/Qoder额度获取实现指南.md
 * 本文件不依赖 Electron，可独立测试（scripts/test-qoder-parse.mjs）。
 */

/** Qoder 站点（国际站 / 国内站，账号不互通） */
export type QoderSite = 'international' | 'china';

interface QoderSiteInfo {
  /** API 主机（无 www） */
  host: string;
  /** Origin 基础值 */
  origin: string;
  /** 可识别的全部主机名（精确匹配，含 www） */
  hosts: string[];
}

export const QODER_SITES: Record<QoderSite, QoderSiteInfo> = {
  international: {
    host: 'qoder.com',
    origin: 'https://qoder.com',
    hosts: ['qoder.com', 'www.qoder.com'],
  },
  china: {
    host: 'qoder.com.cn',
    origin: 'https://qoder.com.cn',
    hosts: ['qoder.com.cn', 'www.qoder.com.cn'],
  },
};

/** 用量 API 路径（两站点相同） */
export const QODER_API_PATH = '/api/v2/me/usages/big_model_credits';

/** 浏览器伪装 UA（协议文档 §6 固定值） */
export const QODER_BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36';

/** 前端版本标识头（协议文档 §6 固定常量，参考实现硬编码此值） */
export const QODER_BX_V = '2.5.35';

/** ---------- 域名归一化与站点判定（§2） ---------- */

/** 归一化主机名：转小写、去首尾空白、去前导点 */
export function normalizeHost(raw: string): string {
  return raw.trim().toLowerCase().replace(/^\.+/, '');
}

function isValidPort(port: string): boolean {
  if (!/^\d{1,5}$/.test(port)) return false;
  const n = Number(port);
  return n >= 1 && n <= 65535;
}

/** 从 host[:port] 判定站点；仅接受四个已知主机名，其余一律不可路由 */
export function detectSiteByHost(rawHost: string): QoderSite | null {
  let host = normalizeHost(rawHost);
  const idx = host.lastIndexOf(':');
  if (idx !== -1) {
    const port = host.slice(idx + 1);
    if (!isValidPort(port)) return null;
    host = host.slice(0, idx);
  }
  for (const [site, info] of Object.entries(QODER_SITES)) {
    if (info.hosts.includes(host)) return site as QoderSite;
  }
  return null;
}

/** 从 URL 判定站点；非法 URL 返回 null */
export function detectSiteByUrl(rawUrl: string): QoderSite | null {
  try {
    const u = new URL(rawUrl);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    return detectSiteByHost(u.host);
  } catch {
    return null;
  }
}

/** ---------- Shell 分词（§4.2 cURL 捕获） ---------- */

/**
 * shell 风格分词：处理单/双引号与反斜杠转义；
 * 行尾 `\`（bash）与 `^`（Windows cmd）视为续行。
 */
export function shellTokenize(text: string): string[] {
  const joined = text.replace(/\\\r?\n/g, ' ').replace(/\^\r?\n/g, ' ');
  const tokens: string[] = [];
  let cur = '';
  let has = false;
  let i = 0;
  while (i < joined.length) {
    const ch = joined[i];
    if (ch === "'") {
      const end = joined.indexOf("'", i + 1);
      if (end === -1) {
        cur += joined.slice(i + 1);
        has = true;
        break;
      }
      cur += joined.slice(i + 1, end);
      has = true;
      i = end + 1;
      continue;
    }
    if (ch === '"') {
      i++;
      while (i < joined.length && joined[i] !== '"') {
        if (joined[i] === '\\' && i + 1 < joined.length && (joined[i + 1] === '"' || joined[i + 1] === '\\')) {
          cur += joined[i + 1];
          i += 2;
          continue;
        }
        cur += joined[i];
        i++;
      }
      has = true;
      i++;
      continue;
    }
    if (ch === '\\' && i + 1 < joined.length && !/\s/.test(joined[i + 1])) {
      cur += joined[i + 1];
      has = true;
      i += 2;
      continue;
    }
    if (/\s/.test(ch)) {
      if (has) tokens.push(cur);
      cur = '';
      has = false;
      i++;
      continue;
    }
    cur += ch;
    has = true;
    i++;
  }
  if (has) tokens.push(cur);
  return tokens;
}

/** ---------- Cookie 头提取（§4.1） ---------- */

function stripCookiePrefix(value: string): string {
  let v = value.trim();
  const m = v.match(/^cookie:\s*/i);
  if (m) v = v.slice(m[0].length);
  if ((v.startsWith("'") && v.endsWith("'")) || (v.startsWith('"') && v.endsWith('"'))) {
    v = v.slice(1, -1);
  }
  return v.trim();
}

/**
 * 从任意粘贴文本中提取 Cookie 值，按顺序尝试以下模式，取第一个非空结果：
 * 1. `-H 'Cookie: …'` / `-H "Cookie: …"`（cURL 头参数）
 * 2. `cookie: '…'` / `cookie: "…"` / `cookie: …`（HTTP 头行）
 * 3. `--cookie …` / `-b …`（引号或裸值）
 */
export function extractCookieHeader(text: string): string {
  // 模式 1：curl -H 参数（值部分单独成对引号包裹）
  const curlH = text.match(/-H\s+(['"])\s*cookie:[^]*?\1/i);
  if (curlH) {
    const inner = text.slice((curlH.index ?? 0) + curlH[0].indexOf(curlH[1]) + 1);
    const endIdx = inner.indexOf(curlH[1]);
    const value = stripCookiePrefix(endIdx === -1 ? inner : inner.slice(0, endIdx));
    if (value) return value;
  }

  // 模式 2：HTTP 头行
  const headerLine = text.match(/^[ \t]*cookie:[ \t]*(.+)$/im);
  if (headerLine) {
    const value = stripCookieHeaderLine(headerLine[1]);
    if (value) return value;
  }

  // 模式 3：--cookie / -b
  const cookieFlag = text.match(/(?:--cookie|-b)[ =]+(['"])([^]*?)\1/);
  if (cookieFlag) {
    const value = stripCookiePrefix(cookieFlag[2]);
    if (value) return value;
  }
  const cookieFlagBare = text.match(/(?:--cookie|-b)[ =]+([^\s'"]+)/);
  if (cookieFlagBare) {
    const value = stripCookiePrefix(cookieFlagBare[1]);
    if (value) return value;
  }

  return '';
}

/** HTTP 头行值：去掉外层引号包裹 */
function stripCookieHeaderLine(value: string): string {
  let v = value.trim();
  if ((v.startsWith("'") && v.endsWith("'")) || (v.startsWith('"') && v.endsWith('"'))) {
    v = v.slice(1, -1);
  }
  return v.trim();
}

/** ---------- 手动捕获路由（§4.2） ---------- */

export interface ManualCaptureResult {
  ok: boolean;
  /** 路由出的站点（ok 时必有） */
  site?: QoderSite;
  /** 提取出的 Cookie 头（ok 时必有） */
  cookieHeader?: string;
  /** Cookie 键值对数量 */
  cookieCount?: number;
  /** 失败原因（ok=false 时）：empty / invalid */
  error?: string;
}

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

/** 解析 cURL 捕获：shell 分词 → 跳过环境赋值前缀 → 定位 curl → 恰一 URL 目标 → Host 一致 */
function parseCurlCapture(tokens: string[]): ManualCaptureResult {
  let start = 0;
  while (start < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[start])) {
    start++;
  }
  const curlIdx = tokens.findIndex((t, i) => i >= start && t.toLowerCase() === 'curl');
  if (curlIdx === -1) return { ok: false, error: 'invalid' };

  // 收集 URL 目标：紧跟 curl 的裸 URL 或 --url 参数值
  const urlTargets: string[] = [];
  for (let i = curlIdx + 1; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === '--url') {
      if (i + 1 < tokens.length) urlTargets.push(tokens[i + 1]);
      i++;
    } else if (!t.startsWith('-')) {
      // 第一个非选项参数即 URL 目标（curl 语义）
      urlTargets.push(t);
    } else {
      // 跳过带值选项（-H/-b/--cookie 后跟一个值）
      if (t === '-H' || t === '-b' || t === '--cookie') i++;
    }
  }
  const urls = urlTargets.filter((u) => /^https?:\/\//i.test(u));
  if (urls.length !== 1) return { ok: false, error: 'invalid' };

  const site = detectSiteByUrl(urls[0]);
  if (!site) return { ok: false, error: 'invalid' };

  // Host 头必须与 URL 站点一致
  const hostValues: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i] === '-H' && i + 1 < tokens.length) {
      const m = tokens[i + 1].match(/^\s*host:\s*(.+)$/i);
      if (m) hostValues.push(m[1].trim());
    }
  }
  for (const h of hostValues) {
    if (detectSiteByHost(h) !== site) return { ok: false, error: 'invalid' };
  }

  const cookieHeader = extractCookieFromTokens(tokens.slice(curlIdx));
  if (!cookieHeader) return { ok: false, error: 'invalid' };
  return { ok: true, site, cookieHeader, cookieCount: countCookies(cookieHeader) };
}

/** 解析原始 HTTP 请求捕获：请求行 + Host 头 */
function parseRawHttpCapture(text: string): ManualCaptureResult | null {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length === 0) return null;
  const reqLine = lines[0].match(/^([A-Za-z]+)\s+(\S+)(?:\s+HTTP\/[\d.]+)?\s*$/);
  if (!reqLine) return null;
  const method = reqLine[1].toUpperCase();
  if (!HTTP_METHODS.includes(method)) return null;

  const target = reqLine[2];
  const hostValues: string[] = [];
  for (const line of lines.slice(1)) {
    const m = line.match(/^[ \t]*host:[ \t]*(.+)$/i);
    if (m) hostValues.push(m[1].trim());
  }

  let site: QoderSite | null = null;
  if (/^https?:\/\//i.test(target)) {
    site = detectSiteByUrl(target);
    if (!site) return { ok: false, error: 'invalid' };
    for (const h of hostValues) {
      if (detectSiteByHost(h) !== site) return { ok: false, error: 'invalid' };
    }
  } else if (target.startsWith('/')) {
    if (hostValues.length === 0) return { ok: false, error: 'invalid' };
    const sites = hostValues.map((h) => detectSiteByHost(h));
    if (sites.some((s) => s === null) || new Set(sites).size !== 1) {
      return { ok: false, error: 'invalid' };
    }
    site = sites[0] as QoderSite;
  } else {
    return null;
  }

  const cookieHeader = extractCookieHeader(text);
  if (!cookieHeader) return { ok: false, error: 'invalid' };
  return { ok: true, site, cookieHeader, cookieCount: countCookies(cookieHeader) };
}

/** 解析纯 Cookie 头：默认国际站，`domain=` 片段可覆盖，冲突或未知域名判无效 */
function parsePureCookieHeader(text: string): ManualCaptureResult {
  const cookieHeader = extractCookieHeader(text);
  // 纯 Cookie 头场景：文本本身就是 Cookie 值（裸 a=b; c=d 直接作为值）
  const value = cookieHeader || stripCookiePrefix(text);
  if (!value) return { ok: false, error: 'invalid' };

  const domainMatches = [...value.matchAll(/(?:^|;\s*)domain=([^;\s]+)/gi)].map((m) => m[1]);
  if (domainMatches.length > 0) {
    const sites = domainMatches.map((h) => detectSiteByHost(h));
    if (sites.some((s) => s === null) || new Set(sites).size !== 1) {
      return { ok: false, error: 'invalid' };
    }
    return { ok: true, site: sites[0] as QoderSite, cookieHeader: value, cookieCount: countCookies(value) };
  }
  return { ok: true, site: 'international', cookieHeader: value, cookieCount: countCookies(value) };
}

function countCookies(header: string): number {
  return header.split(';').filter((p) => p.trim() !== '' && p.includes('=')).length;
}

/** 从已分词的 cURL 参数中提取 Cookie：-H 'cookie: …' 或 --cookie/-b 值（引号已被分词消耗） */
function extractCookieFromTokens(tokens: string[]): string {
  for (let i = 0; i + 1 < tokens.length; i++) {
    if (tokens[i] === '-H' && /^\s*cookie:/i.test(tokens[i + 1])) {
      const value = stripCookiePrefix(tokens[i + 1]);
      if (value) return value;
    }
    if (tokens[i] === '--cookie' || tokens[i] === '-b') {
      const value = stripCookiePrefix(tokens[i + 1]);
      if (value) return value;
    }
  }
  return '';
}

/**
 * 手动捕获解析入口：按 cURL → 原始 HTTP 请求 → 纯 Cookie 头顺序判定，命中即停止。
 * 文本看似包含 curl 命令但不满足结构时直接判为无效（不回退到其他格式）。
 */
export function parseManualCapture(raw: string): ManualCaptureResult {
  const text = (raw ?? '').trim();
  if (!text) return { ok: false, error: 'empty' };

  const tokens = shellTokenize(text);
  const looksLikeCurl =
    tokens.some((t) => t.toLowerCase() === 'curl') || /(?:^|\s)curl(?:\s|$)/i.test(text);
  if (looksLikeCurl) return parseCurlCapture(tokens);

  const http = parseRawHttpCapture(text);
  if (http) return http;

  return parsePureCookieHeader(text);
}

/** ---------- 用量响应解析与额度合并（§7） ---------- */

export interface QoderUsageSnapshot {
  usedCredits: number;
  totalCredits: number;
  remainingCredits: number;
  /** 已钳制到 [0, 100] */
  usagePercentage: number;
  unit: string;
  /** 重置时间 ISO 8601，未知为 null */
  resetsAt: string | null;
}

/** 同名兼容 camelCase 与 snake_case 读取 */
function pick(obj: Record<string, unknown> | undefined | null, camel: string, snake: string): unknown {
  if (!obj) return undefined;
  if (obj[camel] !== undefined) return obj[camel];
  return obj[snake];
}

/** 数值字段兼容 JSON number 与 string */
function asNumber(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return undefined;
}

/** nextResetAt 兼容 ISO 8601 字符串（含/不含毫秒）与 Unix 秒/毫秒时间戳 */
function parseResetAt(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v === 'string') {
    const t = Date.parse(v);
    return Number.isNaN(t) ? null : new Date(t).toISOString();
  }
  const n = asNumber(v);
  if (n === undefined) return null;
  const ms = n > 10_000_000_000 ? n : n * 1000;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

class QoderParseError extends Error {}

interface QuotaTriple {
  used: number;
  total: number;
  remaining: number;
  serverPercent?: number;
  unit?: string;
}

function readQuotaSummary(summary: Record<string, unknown>, what: string): QuotaTriple {
  const used = asNumber(pick(summary, 'usedValue', 'used_value'));
  const total = asNumber(pick(summary, 'limitValue', 'limit_value'));
  if (used === undefined || total === undefined) {
    throw new QoderParseError(`missing ${what}.usedValue/limitValue`);
  }
  const remaining =
    asNumber(pick(summary, 'remainingValue', 'remaining_value')) ?? Math.max(0, total - used);
  if (used < 0 || total < 0 || remaining < 0) {
    throw new QoderParseError(`negative value in ${what}`);
  }
  if (total === 0 && !(used === 0 && remaining === 0)) {
    throw new QoderParseError(`inconsistent zero-limit in ${what}`);
  }
  const serverPercent = asNumber(pick(summary, 'usagePercentage', 'usage_percentage'));
  const unitRaw = pick(summary, 'unit', 'unit');
  return {
    used,
    total,
    remaining,
    serverPercent,
    unit: typeof unitRaw === 'string' && unitRaw.trim() !== '' ? unitRaw : undefined,
  };
}

/**
 * 解析用量 API 响应并合并主额度与共享额度：
 * - 无 sharedQuota：三值取主额度，百分比优先服务端值
 * - 有 sharedQuota：三值求和，百分比必须本地重算（忽略服务端百分比）
 */
export function parseQoderUsageBody(body: unknown): QoderUsageSnapshot {
  if (typeof body !== 'object' || body === null) {
    throw new QoderParseError('invalid body');
  }
  const root = body as Record<string, unknown>;
  const totalQuota = pick(root, 'totalQuota', 'total_quota');
  if (typeof totalQuota !== 'object' || totalQuota === null) {
    throw new QoderParseError('missing totalQuota.quotaSummary');
  }
  const mainSummary = pick(totalQuota as Record<string, unknown>, 'quotaSummary', 'quota_summary');
  if (typeof mainSummary !== 'object' || mainSummary === null) {
    throw new QoderParseError('missing totalQuota.quotaSummary');
  }
  const main = readQuotaSummary(mainSummary as Record<string, unknown>, 'totalQuota');

  let used = main.used;
  let total = main.total;
  let remaining = main.remaining;
  let percent = main.serverPercent ?? (total > 0 ? (used / total) * 100 : 100);
  let unit = main.unit;

  const sharedQuota = pick(root, 'sharedQuota', 'shared_quota');
  if (sharedQuota !== undefined && sharedQuota !== null) {
    if (typeof sharedQuota !== 'object') {
      throw new QoderParseError('invalid sharedQuota');
    }
    const sharedSummary = pick(sharedQuota as Record<string, unknown>, 'quotaSummary', 'quota_summary');
    if (sharedSummary === undefined || sharedSummary === null) {
      throw new QoderParseError('missing sharedQuota.quotaSummary');
    }
    if (typeof sharedSummary !== 'object') {
      throw new QoderParseError('invalid sharedQuota.quotaSummary');
    }
    const shared = readQuotaSummary(sharedSummary as Record<string, unknown>, 'sharedQuota');
    used += shared.used;
    total += shared.total;
    remaining += shared.remaining;
    percent = total > 0 ? (used / total) * 100 : 100;
    unit = unit ?? shared.unit;
  }

  const usagePercentage = Math.min(100, Math.max(0, percent));
  return {
    usedCredits: used,
    totalCredits: total,
    remainingCredits: remaining,
    usagePercentage,
    unit: unit ?? 'credits',
    resetsAt: parseResetAt(pick(root, 'nextResetAt', 'next_reset_at')),
  };
}
