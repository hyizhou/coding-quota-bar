/**
 * Codex Provider：只读本机 Codex CLI 登录凭证查询用量；
 * token 过期时自行刷新并写入应用自管缓存，绝不修改用户的凭证文件
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { app, safeStorage } from 'electron';
import { HttpClient, HttpResponse } from '../main/http';
import type { CodexUsageStats, Provider, ProviderConfig, QuotaItem, UsageResult } from '../shared/types';

const TOKEN_EXPIRED = 'TOKEN_EXPIRED';

const USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage';
const REFRESH_URL = 'https://auth.openai.com/oauth/token';
const RESET_CREDITS_URL = 'https://chatgpt.com/backend-api/wham/rate-limit-reset-credits';
const PROFILE_URL = 'https://chatgpt.com/backend-api/wham/profiles/me';
const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';

const DAY_SECONDS = 86400;

/** Codex CLI 凭证文件（auth.json）结构 */
interface CodexAuthFile {
  tokens?: {
    access_token?: string;
    refresh_token?: string;
    id_token?: string;
    account_id?: string;
  };
  last_refresh?: string;
}

/** Usage API 响应 */
interface CodexUsageResponse {
  rate_limit?: CodexRateLimitInfo;
  code_review_rate_limit?: CodexRateLimitInfo;
  additional_rate_limits?: CodexAdditionalRateLimit[];
  plan_type?: string;
  credits?: {
    balance?: string | null;
    has_credits?: boolean;
    unlimited?: boolean;
  };
}

interface CodexRateLimitInfo {
  limit_reached?: boolean;
  primary_window?: CodexWindowInfo;
  secondary_window?: CodexWindowInfo;
}

interface CodexWindowInfo {
  used_percent?: number | string;
  limit_window_seconds?: number | string;
  reset_at?: number | string;
  reset_after_seconds?: number | string;
}

/** usage 响应中的额外限额项（分模型/专项额度） */
interface CodexAdditionalRateLimit {
  limit_name?: string;
  metered_feature?: string;
  rate_limit?: CodexRateLimitInfo;
}

/** Token 刷新响应 */
interface TokenRefreshResponse {
  access_token: string;
  refresh_token?: string;  // 当前 OpenAI 不返回此字段；一旦出现即说明切换为轮换制
  id_token?: string;
}

/** 限流重置信用库存响应 */
interface CodexResetCreditsResponse {
  credits?: {
    status?: string;
    expires_at?: string;
  }[];
  available_count?: number | string;
}

/** 使用统计响应（profiles 接口） */
interface CodexProfileResponse {
  stats?: {
    lifetime_tokens?: number | string;
    peak_daily_tokens?: number | string;
    current_streak_days?: number | string;
    longest_streak_days?: number | string;
    daily_usage_buckets?: unknown;
  };
}

/** 应用自管的 Codex token 缓存（绝不写用户的凭证文件） */
interface CodexTokenCache {
  token: string;      // 'enc:base64'（safeStorage 加密）或明文（safeStorage 不可用时降级）
  expiresAt: number;  // 毫秒时间戳，来自 JWT exp
  lastRefresh: string;
  rotationDetected?: boolean;  // 检测到 refresh_token 轮换制后永久停用自刷新
}

interface UserInfo {
  email?: string;
  planType?: string;
  organizationName?: string;
  subscriptionActiveUntil?: string;
}

type WindowKind = 'session' | 'weekly';

/**
 * 候选凭证路径：CODEX_HOME、~/.config/codex、~/.codex，
 * 按序取第一个能读到 access_token 的
 */
function getCodexAuthPaths(): string[] {
  const paths: string[] = [];
  const codeHome = process.env.CODEX_HOME?.trim();
  if (codeHome) paths.push(path.resolve(codeHome, 'auth.json'));
  paths.push(path.join(os.homedir(), '.config', 'codex', 'auth.json'));
  paths.push(path.join(os.homedir(), '.codex', 'auth.json'));
  return [...new Set(paths)];
}

function readCodexAuthFile(): CodexAuthFile | null {
  for (const authPath of getCodexAuthPaths()) {
    try {
      const raw = fs.readFileSync(authPath, 'utf-8');
      const auth = JSON.parse(raw) as CodexAuthFile;
      if (auth?.tokens?.access_token) return auth;
    } catch {
      // 当前候选路径不可读或无有效 token，继续尝试下一个
    }
  }
  return null;
}

/**
 * 解码 JWT payload（不验证签名，仅提取 claims）
 */
function decodeJWTPayload(token: string): Record<string, unknown> | null {
  const segments = token.split('.');
  if (segments.length < 2) return null;

  let base64 = segments[1];
  // 补齐 padding
  const padLength = (4 - base64.length % 4) % 4;
  base64 += '='.repeat(padLength);
  // URL-safe → standard
  base64 = base64.replace(/-/g, '+').replace(/_/g, '/');

  try {
    const json = Buffer.from(base64, 'base64').toString('utf-8');
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/**
 * 检查 access_token 是否过期（提前 60s 判定）
 */
function isTokenExpired(accessToken: string): boolean {
  const claims = decodeJWTPayload(accessToken);
  if (!claims) return true;
  const exp = claims.exp as number | undefined;
  if (!exp) return true;
  return Date.now() / 1000 > exp - 60;
}

function getCodexCachePath(): string {
  return path.join(app.getPath('userData'), 'codex-auth-cache.json');
}

/**
 * 读取应用自管 token 缓存；损坏/解密失败按无缓存处理
 */
function readCodexTokenCache(): { accessToken: string | null; rotationDetected: boolean } | null {
  try {
    const raw = fs.readFileSync(getCodexCachePath(), 'utf-8');
    const cache = JSON.parse(raw) as CodexTokenCache;
    if (!cache) return null;
    let accessToken: string | null = null;
    if (cache.token) {
      let stored = cache.token;
      if (stored.startsWith('enc:')) {
        stored = safeStorage.decryptString(Buffer.from(stored.slice(4), 'base64'));
      }
      accessToken = stored || null;
    }
    return { accessToken, rotationDetected: cache.rotationDetected === true };
  } catch {
    return null;
  }
}

/**
 * 将刷新后的 access_token 写入应用自管缓存（临时文件 + rename 原子替换）；
 * 只存 access_token，refresh_token 永远从用户文件现读
 */
function writeCodexTokenCache(accessToken: string, rotationDetected: boolean = false): void {
  try {
    const claims = decodeJWTPayload(accessToken);
    const expSec = (claims?.exp as number | undefined) ?? 0;
    let token = accessToken;
    if (safeStorage.isEncryptionAvailable()) {
      token = 'enc:' + safeStorage.encryptString(accessToken).toString('base64');
    }
    const cache: CodexTokenCache = {
      token,
      expiresAt: expSec * 1000,
      lastRefresh: new Date().toISOString(),
      rotationDetected,
    };
    const cachePath = getCodexCachePath();
    const tmpPath = cachePath + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(cache, null, 2), 'utf-8');
    fs.renameSync(tmpPath, cachePath);
  } catch (e) {
    // 写缓存失败不中断本次查询（token 已在内存中），仅开发模式提示
    console.warn('[Codex] Failed to write app token cache:', e);
  }
}

/**
 * 从 id_token 中提取用户信息
 */
function extractUserInfo(idToken: string): UserInfo {
  const claims = decodeJWTPayload(idToken);
  if (!claims) return {};
  const email = claims.email as string | undefined;
  const authInfo = claims['https://api.openai.com/auth'] as Record<string, unknown> | undefined;
  const planType = authInfo?.chatgpt_plan_type as string | undefined;

  let organizationName: string | undefined;
  if (authInfo?.organizations && Array.isArray(authInfo.organizations) && authInfo.organizations.length > 0) {
    organizationName = authInfo.organizations[0]?.title as string | undefined;
  }

  let subscriptionActiveUntil: string | undefined;
  if (authInfo?.chatgpt_subscription_active_until) {
    subscriptionActiveUntil = authInfo.chatgpt_subscription_active_until as string;
  }

  return { email, planType, organizationName, subscriptionActiveUntil };
}

/** 数值字段容错解析：支持 number 与数字字符串 */
function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/** 百分比解析并夹取到 0-100 */
function parsePercent(value: unknown): number {
  const n = toNumber(value);
  if (n === null) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function parseEpochSeconds(value: unknown): number | null {
  const n = toNumber(value);
  return n !== null && n > 0 ? n : null;
}

function epochToISOString(seconds: number | null): string {
  return seconds ? new Date(seconds * 1000).toISOString() : '';
}

function windowLengthSeconds(window: CodexWindowInfo): number | null {
  const n = toNumber(window.limit_window_seconds);
  return n !== null && n > 0 ? n : null;
}

/**
 * 判定窗口类型：limit_window_seconds 是窗口总长（≥6 天为周窗口，≤1 天为会话窗口）；
 * 缺失时用 reset_after_seconds 兜底——它是窗口剩余时间而非总长，剩余超过一天
 * 即可确定是周窗口，否则按位置（primary=会话、secondary=周）判定
 */
function classifyWindow(window: CodexWindowInfo, positionalKind: WindowKind): WindowKind {
  const seconds = windowLengthSeconds(window);
  if (seconds !== null) {
    if (seconds >= 6 * DAY_SECONDS) return 'weekly';
    if (seconds <= DAY_SECONDS) return 'session';
    return positionalKind;
  }
  const resetAfter = toNumber(window.reset_after_seconds);
  if (resetAfter !== null && resetAfter > DAY_SECONDS) return 'weekly';
  return positionalKind;
}

/** 本地时区 YYYY-MM-DD */
function localDateString(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function normalizeDateKey(value: string): string {
  return value.length >= 10 ? value.slice(0, 10) : value;
}

/**
 * 解析每日 Token 用量桶，兼容数组（[{date, tokens}]）与对象（{date: tokens}）两种形态
 */
function parseDailyBuckets(value: unknown): Map<string, number> {
  const buckets = new Map<string, number>();
  if (Array.isArray(value)) {
    for (const item of value) {
      if (!item || typeof item !== 'object') continue;
      const obj = item as Record<string, unknown>;
      const rawDate = obj.date ?? obj.day ?? obj.start_date ?? obj.bucket;
      const tokens = toNumber(obj.tokens ?? obj.token_count ?? obj.total_tokens ?? obj.value ?? obj.count)
        ?? ((toNumber(obj.input_tokens) ?? 0) + (toNumber(obj.output_tokens) ?? 0));
      if (typeof rawDate === 'string' && tokens > 0) {
        buckets.set(normalizeDateKey(rawDate), tokens);
      }
    }
  } else if (value && typeof value === 'object') {
    for (const [rawDate, rawTokens] of Object.entries(value as Record<string, unknown>)) {
      const tokens = toNumber(rawTokens);
      if (tokens !== null && tokens > 0) buckets.set(normalizeDateKey(rawDate), tokens);
    }
  }
  return buckets;
}

export class CodexProvider implements Provider {
  name = 'Codex';

  async fetchUsage(_config: ProviderConfig): Promise<UsageResult> {
    // 1. 读取凭证文件
    const authFile = readCodexAuthFile();
    const tokens = authFile?.tokens;
    if (!tokens?.access_token) {
      return this.errorResult(TOKEN_EXPIRED);
    }

    let accessToken = tokens.access_token;
    let idToken = tokens.id_token;
    let accountId = tokens.account_id;

    // 2. token 过期时：用户文件绝对只读，优先用应用自管缓存，其次刷新并写入应用缓存
    if (isTokenExpired(accessToken)) {
      const cached = readCodexTokenCache();
      if (cached?.accessToken && !isTokenExpired(cached.accessToken)) {
        accessToken = cached.accessToken;
      } else {
        const refreshed = await this.refreshAccessToken(tokens.refresh_token, cached?.rotationDetected === true);
        if (refreshed) {
          accessToken = refreshed.accessToken;
          if (refreshed.idToken) idToken = refreshed.idToken;
        }
      }
    }

    // 3. 调用 usage API；401/403 时重读凭证文件、刷新后重试一次
    let resp: HttpResponse;
    try {
      resp = await this.requestUsage(accessToken, accountId);
    } catch (e) {
      return this.errorResult(`[Codex] Network error: ${(e as Error).message}`);
    }

    if (resp.status === 401 || resp.status === 403) {
      const latest = readCodexAuthFile();
      const latestRefreshToken = latest?.tokens?.refresh_token || tokens.refresh_token;
      const refreshed = await this.refreshAccessToken(
        latestRefreshToken,
        readCodexTokenCache()?.rotationDetected === true,
      );
      if (refreshed) {
        accessToken = refreshed.accessToken;
        if (refreshed.idToken) idToken = refreshed.idToken;
        accountId = latest?.tokens?.account_id || accountId;
        try {
          resp = await this.requestUsage(accessToken, accountId);
        } catch (e) {
          return this.errorResult(`[Codex] Network error: ${(e as Error).message}`);
        }
      }
    }

    if (resp.status === 401 || resp.status === 403) {
      return this.errorResult(TOKEN_EXPIRED);
    }
    if (resp.status !== 200) {
      return this.errorResult(`[Codex] HTTP ${resp.status}`);
    }

    // 4. 解析响应
    let data: CodexUsageResponse;
    try {
      data = JSON.parse(resp.body);
    } catch {
      return this.errorResult('[Codex] Invalid response');
    }

    const userInfo = idToken ? extractUserInfo(idToken) : {};
    const result = this.transformResult(data, userInfo);

    // 5. 附加数据：限流重置信用与使用统计，失败不影响主数据
    const resetCredits = await this.fetchResetCredits(accessToken, accountId);
    if (resetCredits && result.details?.quotas) {
      result.details.quotas.push(resetCredits);
    }
    if (result.details) {
      const stats = await this.fetchProfileStats(accessToken, accountId);
      if (stats) result.details.codexStats = stats;
    }

    return result;
  }

  private errorResult(error: string): UsageResult {
    return { used: 0, total: 0, expiresAt: '', error, details: { quotas: [] } };
  }

  private async requestUsage(accessToken: string, accountId?: string): Promise<HttpResponse> {
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/json',
      'User-Agent': 'CodexBar',
    };
    if (accountId) {
      headers['ChatGPT-Account-Id'] = accountId;
    }
    return HttpClient.get(USAGE_URL, headers);
  }

  /**
   * 用 refresh_token 换新 access_token；结果只写应用自管缓存；
   * 检测到轮换制（响应出现 refresh_token 字段）后永久停用自刷新
   */
  private async refreshAccessToken(
    refreshToken: string | undefined,
    rotationDetected: boolean
  ): Promise<{ accessToken: string; idToken?: string } | null> {
    if (!refreshToken || rotationDetected) return null;
    try {
      const refreshResp = await HttpClient.post(
        REFRESH_URL,
        JSON.stringify({
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          client_id: CLIENT_ID,
        }),
      );
      if (refreshResp.status < 200 || refreshResp.status >= 300) {
        console.warn(`[Codex] Token refresh failed: HTTP ${refreshResp.status}`);
        return null;
      }
      const refreshData = JSON.parse(refreshResp.body) as TokenRefreshResponse;
      const rotated = typeof refreshData.refresh_token === 'string' && refreshData.refresh_token.length > 0;
      if (rotated) {
        console.warn('[Codex] Refresh token rotation detected, self-refresh disabled');
      }
      writeCodexTokenCache(refreshData.access_token, rotated);
      return { accessToken: refreshData.access_token, idToken: refreshData.id_token };
    } catch (e) {
      console.warn('[Codex] Token refresh error:', e);
      return null;
    }
  }

  private authHeaders(
    accessToken: string,
    accountId: string | undefined,
    extra: Record<string, string>
  ): Record<string, string> {
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/json',
      ...extra,
    };
    if (accountId) {
      headers['ChatGPT-Account-Id'] = accountId;
    }
    return headers;
  }

  /**
   * 查询限流重置信用库存；卡片截止时间取最早过期的可用额度
   */
  private async fetchResetCredits(accessToken: string, accountId?: string): Promise<QuotaItem | null> {
    try {
      const resp = await HttpClient.get(
        RESET_CREDITS_URL,
        this.authHeaders(accessToken, accountId, {
          'OpenAI-Beta': 'codex-1',
          'originator': 'Codex Desktop',
        }),
      );
      if (resp.status !== 200) return null;
      const data = JSON.parse(resp.body) as CodexResetCreditsResponse;
      const count = toNumber(data.available_count);
      if (count === null || count < 0) return null;

      let nearestExpiry = '';
      for (const credit of data.credits ?? []) {
        if (credit.status !== 'available' || !credit.expires_at) continue;
        const ts = Date.parse(credit.expires_at);
        if (Number.isNaN(ts) || ts <= Date.now()) continue;
        if (!nearestExpiry || credit.expires_at < nearestExpiry) nearestExpiry = credit.expires_at;
      }

      return {
        label: 'quota.codexResetCredits',
        used: Math.floor(count),
        total: 0,
        usageRate: 0,
        resetAt: nearestExpiry,
        hideBar: true,
        displayUnit: 'count',
        limitType: 'codex-reset-credits',
      };
    } catch (e) {
      console.warn('[Codex] Failed to fetch reset credits:', e);
      return null;
    }
  }

  /**
   * 查询使用统计（日级 Token 用量、连续使用天数等）
   */
  private async fetchProfileStats(accessToken: string, accountId?: string): Promise<CodexUsageStats | null> {
    try {
      const resp = await HttpClient.get(
        PROFILE_URL,
        this.authHeaders(accessToken, accountId, { 'Originator': 'Codex Desktop' }),
      );
      if (resp.status !== 200) return null;
      const data = JSON.parse(resp.body) as CodexProfileResponse;
      const stats = data.stats;
      if (!stats) return null;

      const buckets = parseDailyBuckets(stats.daily_usage_buckets);
      const now = new Date();
      const today = localDateString(now);
      const yesterday = localDateString(new Date(now.getTime() - DAY_SECONDS * 1000));
      const last30Start = localDateString(new Date(now.getTime() - 29 * DAY_SECONDS * 1000));
      let last30dTokens = 0;
      for (const [date, tokens] of buckets) {
        if (date >= last30Start) last30dTokens += tokens;
      }

      const lifetime = toNumber(stats.lifetime_tokens);
      const peakDaily = toNumber(stats.peak_daily_tokens);
      const currentStreak = toNumber(stats.current_streak_days);
      const longestStreak = toNumber(stats.longest_streak_days);
      if (
        buckets.size === 0 &&
        lifetime === null &&
        peakDaily === null &&
        currentStreak === null &&
        longestStreak === null
      ) {
        return null;
      }

      return {
        todayTokens: buckets.get(today) ?? 0,
        yesterdayTokens: buckets.get(yesterday) ?? 0,
        last30dTokens,
        lifetimeTokens: lifetime ?? undefined,
        peakDailyTokens: peakDaily ?? undefined,
        currentStreakDays: currentStreak ?? undefined,
        longestStreakDays: longestStreak ?? undefined,
      };
    } catch (e) {
      console.warn('[Codex] Failed to fetch profile stats:', e);
      return null;
    }
  }

  private transformResult(data: CodexUsageResponse, userInfo: UserInfo): UsageResult {
    const rateLimit = data.rate_limit;
    const limitReached = rateLimit?.limit_reached ?? false;

    const planType = data.plan_type || userInfo.planType;
    // 格式化 plan type：首字母大写
    const level = planType ? planType.charAt(0).toUpperCase() + planType.slice(1).toLowerCase() : undefined;

    const quotas: QuotaItem[] = [];

    // 主/次窗口：按窗口时长判定会话/周窗口，同类窗口只保留第一个
    const usedKinds = new Set<WindowKind>();
    const standardWindows: { window?: CodexWindowInfo; positionalKind: WindowKind }[] = [
      { window: rateLimit?.primary_window, positionalKind: 'session' },
      { window: rateLimit?.secondary_window, positionalKind: 'weekly' },
    ];
    let mainPercent = 0;
    let mainResetAt = '';
    for (const { window, positionalKind } of standardWindows) {
      if (!window) continue;
      const kind = classifyWindow(window, positionalKind);
      if (usedKinds.has(kind)) continue;
      usedKinds.add(kind);

      if (usedKinds.size === 1) {
        mainPercent = parsePercent(window.used_percent);
        mainResetAt = epochToISOString(parseEpochSeconds(window.reset_at));
      }
      const lengthSeconds = windowLengthSeconds(window);
      if (kind === 'weekly') {
        quotas.push(this.windowQuota(window, 'quota.codexWeeklyWindow', undefined, 'codex'));
      } else if (lengthSeconds) {
        quotas.push(this.windowQuota(
          window,
          'quota.codexSessionWindow',
          { n: Math.round(lengthSeconds / 3600) },
          'codex',
        ));
      } else {
        quotas.push(this.windowQuota(
          window,
          positionalKind === 'session' ? 'quota.codexPrimaryWindow' : 'quota.codexSecondaryWindow',
          undefined,
          'codex',
        ));
      }
    }

    // 代码审查限流（可选）
    const codeReview = data.code_review_rate_limit;
    if (codeReview?.primary_window) {
      quotas.push(this.windowQuota(codeReview.primary_window, 'quota.codexCodeReview', undefined, 'codex-review'));
    }

    // 额外限额：spark 类拆分会话/周双窗口，其余按名称展示
    const sparkKinds = new Set<WindowKind>();
    const extraNames = new Set<string>();
    for (const limit of data.additional_rate_limits ?? []) {
      const name = (limit.metered_feature || limit.limit_name || '').trim();
      const rate = limit.rate_limit;
      if (!name || !rate) continue;

      if (name.toLowerCase().includes('spark')) {
        const sparkWindows: { window?: CodexWindowInfo; positionalKind: WindowKind }[] = [
          { window: rate.primary_window, positionalKind: 'session' },
          { window: rate.secondary_window, positionalKind: 'weekly' },
        ];
        for (const { window, positionalKind } of sparkWindows) {
          if (!window) continue;
          const kind = classifyWindow(window, positionalKind);
          if (sparkKinds.has(kind)) continue;
          sparkKinds.add(kind);
          const lengthSeconds = windowLengthSeconds(window);
          quotas.push(
            kind === 'weekly'
              ? this.windowQuota(window, 'quota.codexSparkWeekly', undefined, 'codex-spark')
              : this.windowQuota(
                  window,
                  'quota.codexSparkSession',
                  lengthSeconds ? { n: Math.round(lengthSeconds / 3600) } : undefined,
                  'codex-spark',
                ),
          );
        }
        continue;
      }

      const window = rate.primary_window ?? rate.secondary_window;
      if (!window) continue;
      const dedupeKey = name.toLowerCase();
      if (extraNames.has(dedupeKey)) continue;
      extraNames.add(dedupeKey);
      quotas.push(this.windowQuota(window, 'quota.codexExtraLimit', { name }, 'codex-extra'));
    }

    // 余额
    if (data.credits?.balance != null) {
      const balanceNum = parseFloat(data.credits.balance);
      if (!isNaN(balanceNum)) {
        const isUnlimited = data.credits.unlimited ?? false;
        quotas.push({
          label: isUnlimited ? 'quota.codexCreditsUnlimited' : 'quota.codexCredits',
          used: balanceNum,
          total: 0,
          usageRate: 0,
          resetAt: '',
          hideBar: true,
          currency: 'USD',
          limitType: 'codex-credits',
        });
      }
    }

    // 订阅到期信息
    if (userInfo.subscriptionActiveUntil) {
      quotas.push({
        label: 'quota.codexSubscriptionUntil',
        used: 0,
        total: 0,
        usageRate: 0,
        resetAt: userInfo.subscriptionActiveUntil,
        hideBar: true,
        limitType: 'codex-subscription',
      });
    }

    return {
      used: mainPercent,
      total: 100,
      expiresAt: mainResetAt,
      level,
      details: {
        quotas,
        limitReached,
        codexOrgName: userInfo.organizationName,
      },
    };
  }

  private windowQuota(
    window: CodexWindowInfo,
    label: string,
    labelParams: Record<string, string | number> | undefined,
    limitType: string
  ): QuotaItem {
    const percent = parsePercent(window.used_percent);
    return {
      label,
      labelParams,
      used: percent,
      total: 100,
      usageRate: percent,
      resetAt: epochToISOString(parseEpochSeconds(window.reset_at)),
      limitType,
    };
  }
}
