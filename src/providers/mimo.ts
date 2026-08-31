import { BrowserWindow } from 'electron';
import type { Provider, ProviderConfig, QuotaItem, UsageResult } from '../shared/types';

const TOKEN_EXPIRED = 'TOKEN_EXPIRED';

interface MiMoDetailData {
  planCode: string;
  planName: string;
  currentPeriodEnd: string;
  expired: boolean;
  enableAutoRenew: boolean;
  autoRenewDiscount: string;
  hasAutoRenewSubscribed: boolean;
}

interface MiMoUsageItem {
  name: string;
  used: number;
  limit: number;
  percent: number;
}

interface MiMoUsageData {
  monthUsage: { percent: number; items: MiMoUsageItem[] };
  usage: { percent: number; items: MiMoUsageItem[] };
}

interface MiMoUsageDailyItem {
  date: string;            // 'YYYY-MM-DD'
  model: string;
  totalToken: number;
  inputHitToken: number;
  inputMissToken: number;
  outputToken: number;
  requestCount: number;
  consumedAmount: string;
  currency: string;
}

interface MiMoBalanceData {
  balance: string;
  frozenBalance: string;
  currency: string;
  overdraftLimit: string;
  remainingOverdraftLimit: string;
  giftBalance: string;
  cashBalance: string;
}

interface MiMoApiResponse<T> {
  code: number;
  message: string;
  data: T;
}

const PLAN_LEVEL_MAP: Record<string, string> = {
  lite: 'Lite',
  standard: 'Standard',
  pro: 'Pro',
  max: 'Max',
};

/** 页内 fetch 超时时间：防止 executeJavaScript 永久挂起导致窗口无法销毁 */
const PAGE_FETCH_TIMEOUT = 15000;

/**
 * 为 Promise 加超时保护
 */
function withTimeout<T>(promise: Promise<T>, ms: number = PAGE_FETCH_TIMEOUT): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('Page fetch timeout')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  }) as Promise<T>;
}

/**
 * 通过页面内 fetch 调用 MiMo API（Cookie 天然携带）
 */
async function fetchApiInPage<T>(win: BrowserWindow, path: string): Promise<MiMoApiResponse<T>> {
  const json = await withTimeout(win.webContents.executeJavaScript(`
    fetch('${path}', { credentials: 'include' })
      .then(r => r.json())
  `));
  return json as MiMoApiResponse<T>;
}

/**
 * 通过页面内 POST fetch 调用 MiMo API（自动从 cookie 读取 api-platform_ph 签名）
 */
async function postApiInPage<T>(win: BrowserWindow, path: string, body: Record<string, unknown>): Promise<MiMoApiResponse<T>> {
  const json = await withTimeout(win.webContents.executeJavaScript(`
    (function() {
      var cookies = document.cookie.split(';').map(function(c) { return c.trim(); });
      var phCookie = cookies.find(function(c) { return c.startsWith('api-platform_ph='); });
      var phValue = phCookie ? phCookie.split('=').slice(1).join('=').replace(/^"|"$/g, '') : '';
      var url = '${path}' + (phValue ? '?api-platform_ph=' + encodeURIComponent(phValue) : '');
      return fetch(url, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(${JSON.stringify(body)})
      }).then(function(r) { return r.json(); });
    })()
  `));
  return json as MiMoApiResponse<T>;
}

/**
 * 创建临时隐藏窗口并加载 MiMo 页面
 */
async function createLoadedWindow(accountId: string): Promise<BrowserWindow> {
  const partition = `persist:mimo-${accountId}`;
  const win = new BrowserWindow({
    width: 480,
    height: 400,
    show: false,
    // spellcheck: false —— Windows 拼写组件在沙箱下会往 CWD 写入乱码空目录（Microsoft\Spelling）
    webPreferences: { partition, contextIsolation: true, nodeIntegration: false, webSecurity: true, spellcheck: false },
  });

  // 屏蔽无关请求（小米统计等），避免 SSL 错误噪音输出到主进程控制台
  win.webContents.session.webRequest.onBeforeRequest((details, callback) => {
    if (details.url.includes('tracking.miui.com')) {
      callback({ cancel: true });
    } else {
      callback({});
    }
  });

  // 屏蔽页面 JS 的 console 输出
  win.webContents.on('console-message', () => {});

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      // 超时前先销毁窗口，避免 reject 后窗口残留
      if (!win.isDestroyed()) win.destroy();
      reject(new Error('Page load timeout'));
    }, 15000);
    const onClosed = () => { clearTimeout(timer); reject(new Error('Window destroyed')); };
    win.once('closed', onClosed);
    win.webContents.once('did-finish-load', () => {
      clearTimeout(timer);
      win.removeListener('closed', onClosed);
      resolve();
    });
    // 加载结果由 did-finish-load / closed / 超时 Promise 管理，吞掉 loadURL 自身的 rejection
    win.loadURL('https://platform.xiaomimimo.com/console/balance').catch(() => {});
  });

  // 等待页面 JS 初始化
  await new Promise(r => setTimeout(r, 1000));
  return win;
}

export class MiMoProvider implements Provider {
  name = 'MiMo';

  /** 历史月份数据缓存 key: "accountId:YYYY-MM" */
  private monthCache = new Map<string, import('../shared/types').ModelTokenRecord[]>();

  async fetchUsage(config: ProviderConfig): Promise<UsageResult> {
    const accountId = config.accountId!;
    let win: BrowserWindow | null = null;

    try {
      // 创建临时窗口，加载页面（Cookie 自动携带）
      win = await createLoadedWindow(accountId);

      // 第一次请求
      const result = await this.tryFetch(win);
      if (result) return result;

      // Cookie 可能过期，刷新页面重试
      console.log(`[MiMo] Session expired for ${accountId}, reloading...`);
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Reload timeout')), 15000);
        win!.webContents.once('did-finish-load', () => { clearTimeout(timer); resolve(); });
        win!.webContents.reload();
      });
      await new Promise(r => setTimeout(r, 1000));

      const retry = await this.tryFetch(win);
      if (retry) return retry;

      return { used: 0, total: 0, expiresAt: '', error: TOKEN_EXPIRED, details: { quotas: [] } };
    } catch {
      return { used: 0, total: 0, expiresAt: '', error: TOKEN_EXPIRED, details: { quotas: [] } };
    } finally {
      if (win && !win.isDestroyed()) win.destroy();
    }
  }

  private async tryFetch(win: BrowserWindow): Promise<UsageResult | null> {
    if (win.isDestroyed()) return null;
    try {
      // 先用余额 API 验证登录状态：余额在有套餐和无套餐时都会返回，登录过期则返回 401
      const balanceResp = await fetchApiInPage<MiMoBalanceData>(win, '/api/v1/balance');
      if (balanceResp.code !== 0) return null; // 登录过期，触发 reload 重试

      const now = new Date();
      const [detailResp, usageResp, dailyResp] = await Promise.all([
        fetchApiInPage<MiMoDetailData>(win, '/api/v1/tokenPlan/detail').catch(() => null),
        fetchApiInPage<MiMoUsageData>(win, '/api/v1/tokenPlan/usage').catch(() => null),
        postApiInPage<MiMoUsageDailyItem[]>(win, '/api/v1/usage/token-plan/list', {
          year: now.getFullYear(),
          month: now.getMonth() + 1,
        }).catch(() => null),
      ]);

      // 套餐详情和用量都获取成功且数据完整 → 正常返回
      const usageData = usageResp?.data;
      if (detailResp && detailResp.code === 0 && usageResp && usageResp.code === 0
          && usageData?.usage && usageData?.monthUsage) {
        return this.transformResult(detailResp.data, usageData, dailyResp?.data, balanceResp.data);
      }

      // 套餐过期/未订阅但余额正常 → 返回余额信息 + 过期套餐详情（如有）+ 日报数据
      const detailData = detailResp?.code === 0 ? detailResp.data : undefined;
      return this.buildNoPlanResult(balanceResp.data, detailData, dailyResp?.data);
    } catch {
      return null;
    }
  }

  /** 无有效套餐时，返回余额信息（附过期的套餐详情和日报数据） */
  private buildNoPlanResult(balanceData: MiMoBalanceData, detail?: MiMoDetailData, dailyItems?: MiMoUsageDailyItem[]): UsageResult {
    const planLevel = detail ? (PLAN_LEVEL_MAP[detail.planCode] || detail.planName) : '';

    // 按天聚合每日用量
    const dailyMap = new Map<string, { cacheHit: number; cacheMiss: number; output: number; requests: number }>();
    if (dailyItems && Array.isArray(dailyItems)) {
      for (const item of dailyItems) {
        const existing = dailyMap.get(item.date) || { cacheHit: 0, cacheMiss: 0, output: 0, requests: 0 };
        existing.cacheHit += item.inputHitToken;
        existing.cacheMiss += item.inputMissToken;
        existing.output += item.outputToken;
        existing.requests += item.requestCount;
        dailyMap.set(item.date, existing);
      }
    }
    const modelHistory30d = Array.from(dailyMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, d]) => ({
        date,
        model: 'MiMo',
        used: d.cacheHit + d.cacheMiss + d.output,
        requests: d.requests,
        cacheHitTokens: d.cacheHit,
        cacheMissTokens: d.cacheMiss,
        responseTokens: d.output,
      }));

    const details: Record<string, unknown> = {
      quotas: [],
      subscription: {
        plan: planLevel,
        status: 'EXPIRED',
        currentRenewTime: '',
        nextRenewTime: detail?.currentPeriodEnd || '',
        autoRenew: detail?.enableAutoRenew ?? false,
        actualPrice: 0,
        renewPrice: 0,
        billingCycle: '',
      },
      modelHistory30d,
    };
    details.balance = {
      total: balanceData.balance,
      gift: balanceData.giftBalance,
      cash: balanceData.cashBalance,
      frozen: balanceData.frozenBalance,
      currency: balanceData.currency,
    };
    return { used: 0, total: 0, expiresAt: detail?.currentPeriodEnd || '', level: planLevel, details };
  }

  private transformResult(
    detail: MiMoDetailData,
    usage: MiMoUsageData,
    dailyItems?: MiMoUsageDailyItem[],
    balanceData?: MiMoBalanceData,
  ): UsageResult {
    const planItem = usage.usage?.items?.find(i => i.name === 'plan_total_token');
    const monthItem = usage.monthUsage?.items?.[0];
    const planLevel = PLAN_LEVEL_MAP[detail.planCode] || detail.planName;
    const quotas: QuotaItem[] = [];

    // 本月用量（主指标，使用 plan_total_token，不含补偿额度消耗）
    if (planItem) {
      quotas.push({ label: 'quota.mimoMonthlyUsage', used: planItem.used, total: planItem.limit, usageRate: planItem.percent * 100, resetAt: detail.currentPeriodEnd });
    } else if (monthItem) {
      // 降级：无 plan_total_token 时用 month_total_token
      quotas.push({ label: 'quota.mimoMonthlyUsage', used: monthItem.used, total: monthItem.limit, usageRate: monthItem.percent * 100, resetAt: detail.currentPeriodEnd });
    }
    // 补偿额度（如果有）
    const compItem = usage.usage?.items?.find(i => i.name === 'compensation_total_token');
    if (compItem && compItem.limit > 0) {
      quotas.push({ label: 'quota.mimoCompensation', used: compItem.used, total: compItem.limit, usageRate: compItem.percent * 100, resetAt: detail.currentPeriodEnd });
    }

    // 按天聚合每日用量（可能有多个 model 的记录）
    const dailyMap = new Map<string, { cacheHit: number; cacheMiss: number; output: number; requests: number }>();
    if (dailyItems && Array.isArray(dailyItems)) {
      for (const item of dailyItems) {
        const existing = dailyMap.get(item.date) || { cacheHit: 0, cacheMiss: 0, output: 0, requests: 0 };
        existing.cacheHit += item.inputHitToken;
        existing.cacheMiss += item.inputMissToken;
        existing.output += item.outputToken;
        existing.requests += item.requestCount;
        dailyMap.set(item.date, existing);
      }
    }

    // 转为 ModelTokenRecord 格式（复用渲染端的图表逻辑）
    const modelHistory30d = Array.from(dailyMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, d]) => ({
        date,
        model: 'MiMo',
        used: d.cacheHit + d.cacheMiss + d.output,
        requests: d.requests,
        cacheHitTokens: d.cacheHit,
        cacheMissTokens: d.cacheMiss,
        responseTokens: d.output,
      }));

    const details: Record<string, unknown> = {
      quotas,
      subscription: {
        plan: planLevel,
        status: detail.expired ? 'EXPIRED' : 'VALID',
        currentRenewTime: '',
        nextRenewTime: detail.currentPeriodEnd,
        autoRenew: detail.enableAutoRenew,
        actualPrice: 0,
        renewPrice: 0,
        billingCycle: '',
      },
      modelHistory30d,
    };

    if (balanceData) {
      details.balance = {
        total: balanceData.balance,
        gift: balanceData.giftBalance,
        cash: balanceData.cashBalance,
        frozen: balanceData.frozenBalance,
        currency: balanceData.currency,
      };
    }

    return {
      used: planItem?.used ?? 0,
      total: planItem?.limit ?? 0,
      expiresAt: detail.currentPeriodEnd,
      level: planLevel,
      details,
    };
  }

  /** 按月获取模型 token 历史（供 IPC 按需调用），历史月份自动缓存 */
  async fetchMonthModelHistory(config: ProviderConfig, month: number, year: number): Promise<import('../shared/types').ModelTokenRecord[]> {
    const accountId = config.accountId!;
    const key = `${accountId}:${year}-${String(month).padStart(2, '0')}`;

    // 查缓存
    const cached = this.monthCache.get(key);
    if (cached) return cached;

    // 当前月不缓存（数据会变化）
    const now = new Date();
    const isCurrent = year === now.getFullYear() && month === now.getMonth() + 1;

    let win: BrowserWindow | null = null;
    try {
      win = await createLoadedWindow(accountId);
      const resp = await postApiInPage<MiMoUsageDailyItem[]>(win, '/api/v1/usage/token-plan/list', { year, month });
      if (resp.code !== 0 || !Array.isArray(resp.data)) return [];
      const records = resp.data.map(item => ({
        date: item.date,
        model: item.model,
        used: item.totalToken,
        requests: item.requestCount,
        cacheHitTokens: item.inputHitToken,
        cacheMissTokens: item.inputMissToken,
        responseTokens: item.outputToken,
      }));
      if (!isCurrent) this.monthCache.set(key, records);
      return records;
    } catch {
      return [];
    } finally {
      if (win && !win.isDestroyed()) win.destroy();
    }
  }
}
