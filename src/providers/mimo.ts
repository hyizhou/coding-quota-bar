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

/**
 * 通过页面内 fetch 调用 MiMo API（Cookie 天然携带）
 */
async function fetchApiInPage<T>(win: BrowserWindow, path: string): Promise<MiMoApiResponse<T>> {
  const json = await win.webContents.executeJavaScript(`
    fetch('${path}', { credentials: 'include' })
      .then(r => r.json())
  `);
  return json as MiMoApiResponse<T>;
}

/**
 * 通过页面内 POST fetch 调用 MiMo API（自动从 cookie 读取 api-platform_ph 签名）
 */
async function postApiInPage<T>(win: BrowserWindow, path: string, body: Record<string, unknown>): Promise<MiMoApiResponse<T>> {
  const json = await win.webContents.executeJavaScript(`
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
  `);
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
    webPreferences: { partition, contextIsolation: true, nodeIntegration: false, webSecurity: true },
  });

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Page load timeout')), 15000);
    const onClosed = () => { clearTimeout(timer); reject(new Error('Window destroyed')); };
    win.once('closed', onClosed);
    win.webContents.once('did-finish-load', () => {
      clearTimeout(timer);
      win.removeListener('closed', onClosed);
      resolve();
    });
    win.loadURL('https://platform.xiaomimimo.com/console/balance');
  });

  // 等待页面 JS 初始化
  await new Promise(r => setTimeout(r, 1000));
  return win;
}

export class MiMoProvider implements Provider {
  name = 'MiMo';

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
      const now = new Date();
      const [detailResp, usageResp, dailyResp] = await Promise.all([
        fetchApiInPage<MiMoDetailData>(win, '/api/v1/tokenPlan/detail'),
        fetchApiInPage<MiMoUsageData>(win, '/api/v1/tokenPlan/usage'),
        postApiInPage<MiMoUsageDailyItem[]>(win, '/api/v1/usage/detail/list', {
          year: now.getFullYear(),
          month: now.getMonth() + 1,
        }).catch(() => null),
      ]);
      if (detailResp.code !== 0 || usageResp.code !== 0) return null;
      return this.transformResult(detailResp.data, usageResp.data, dailyResp?.data);
    } catch {
      return null;
    }
  }

  private transformResult(
    detail: MiMoDetailData,
    usage: MiMoUsageData,
    dailyItems?: MiMoUsageDailyItem[],
  ): UsageResult {
    const planItem = usage.usage.items[0];
    const monthItem = usage.monthUsage.items[0];
    const planLevel = PLAN_LEVEL_MAP[detail.planCode] || detail.planName;
    const quotas: QuotaItem[] = [];

    // 本月用量（主指标）
    if (monthItem) {
      quotas.push({ label: 'quota.mimoMonthlyUsage', used: monthItem.used, total: monthItem.limit, usageRate: monthItem.percent * 100, resetAt: detail.currentPeriodEnd });
    }
    // 补偿额度（如果有）
    const compItem = usage.usage.items.find(i => i.name === 'compensation_total_token');
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

    return {
      used: planItem?.used ?? 0,
      total: planItem?.limit ?? 0,
      expiresAt: detail.currentPeriodEnd,
      level: planLevel,
      details: {
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
      },
    };
  }
}
