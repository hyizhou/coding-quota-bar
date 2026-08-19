import { BrowserWindow } from 'electron';
import type { Provider, ProviderConfig, QuotaItem, UsageResult } from '../shared/types';

const TOKEN_EXPIRED = 'TOKEN_EXPIRED';

/** 页内执行超时时间：防止 executeJavaScript 永久挂起导致窗口无法销毁 */
const PAGE_EXEC_TIMEOUT = 15000;

/**
 * 为 Promise 加超时保护
 */
function withTimeout<T>(promise: Promise<T>, ms: number = PAGE_EXEC_TIMEOUT): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('Page exec timeout')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  }) as Promise<T>;
}

interface UsageWindow {
  status: string;
  usagePercent: number;
  resetInSec: number;
}

interface ParsedUsageData {
  rollingUsage: UsageWindow | null;
  weeklyUsage: UsageWindow | null;
  monthlyUsage: UsageWindow | null;
}

/**
 * 正则：从 JS 内嵌数据提取用量窗口
 * 匹配形如 rollingUsage:{...usagePercent:42.5,...resetInSec:1234...}
 */
const USAGE_WINDOW_REGEX = /(?:rollingUsage|weeklyUsage|monthlyUsage)\s*:\s*\{([^}]*)\}/g;
const PERCENT_REGEX = /(?:usagePercent|usedPercent|percentUsed|percent|usage)\s*:\s*([0-9]+(?:\.[0-9]+)?)/;
const RESET_REGEX = /(?:resetInSec|resetInSeconds|resetSec|reset_in_sec|resetsInSec)\s*:\s*([0-9]+)/;
const STATUS_REGEX = /status\s*:\s*["']?(ok|rate-limited)["']?/;

/**
 * 从页面 HTML 中提取 workspace ID
 */
const WORKSPACE_ID_REGEX = /["']?(wrk_[a-zA-Z0-9]+)["']?/g;

/**
 * 未登录/认证失败检测关键词
 */
const AUTH_FAILURE_KEYWORDS = [
  'not associated with an account',
  'actor of type "public"',
  'auth/authorize',
];

/**
 * 创建临时隐藏窗口并加载指定 URL
 */
async function createLoadedWindow(accountId: string, url: string, timeout = 15000): Promise<BrowserWindow> {
  const partition = `persist:opencodego-${accountId}`;
  const win = new BrowserWindow({
    width: 480,
    height: 400,
    show: false,
    webPreferences: { partition, contextIsolation: true, nodeIntegration: false, webSecurity: true },
  });

  // 屏蔽页面 JS 的 console 输出
  win.webContents.on('console-message', () => {});

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      // 超时前先销毁窗口，避免 reject 后窗口残留
      if (!win.isDestroyed()) win.destroy();
      reject(new Error('Page load timeout'));
    }, timeout);
    const onClosed = () => { clearTimeout(timer); reject(new Error('Window destroyed')); };
    win.once('closed', onClosed);
    win.webContents.once('did-finish-load', () => {
      clearTimeout(timer);
      win.removeListener('closed', onClosed);
      resolve();
    });
    // 加载结果由 did-finish-load / closed / 超时 Promise 管理，吞掉 loadURL 自身的 rejection
    win.loadURL(url).catch(() => {});
  });

  // 等待页面 JS 初始化
  await new Promise(r => setTimeout(r, 1500));
  return win;
}

/**
 * 从页面内容检测是否未登录
 */
function isAuthFailure(html: string): boolean {
  const lower = html.toLowerCase();
  return AUTH_FAILURE_KEYWORDS.some(kw => lower.includes(kw.toLowerCase()));
}

/**
 * 获取 workspace ID
 * 先尝试从当前页面 URL 获取，再从页面内容中提取
 */
async function getWorkspaceId(win: BrowserWindow): Promise<string | null> {
  // 1. 检查当前 URL
  const currentUrl = win.webContents.getURL();
  const urlMatch = currentUrl.match(/\/workspace\/(wrk_[a-zA-Z0-9]+)/);
  if (urlMatch) return urlMatch[1];

  // 2. 从页面内容中提取
  try {
    const html = await withTimeout(win.webContents.executeJavaScript(`document.documentElement.outerHTML`));
    const ids: string[] = [];
    let m;
    const regex = new RegExp(WORKSPACE_ID_REGEX.source, 'g');
    while ((m = regex.exec(html)) !== null) {
      if (m[1] && !ids.includes(m[1])) ids.push(m[1]);
    }
    return ids[0] || null;
  } catch {
    return null;
  }
}

/**
 * 从页面 HTML 解析用量数据
 * 策略：先尝试 JSON 解析，失败则用正则提取
 */
function parseUsageFromHtml(html: string): ParsedUsageData {
  const result: ParsedUsageData = {
    rollingUsage: null,
    weeklyUsage: null,
    monthlyUsage: null,
  };

  // 策略 1：正则匹配（更可靠，因为数据嵌入在 JS 中）
  USAGE_WINDOW_REGEX.lastIndex = 0;
  let match;
  while ((match = USAGE_WINDOW_REGEX.exec(html)) !== null) {
    const block = match[0];
    const prefix = match[0].startsWith('rolling') ? 'rolling' :
                   match[0].startsWith('weekly') ? 'weekly' : 'monthly';

    const pctMatch = block.match(PERCENT_REGEX);
    const resetMatch = block.match(RESET_REGEX);
    const statusMatch = block.match(STATUS_REGEX);

    if (pctMatch) {
      const window: UsageWindow = {
        status: statusMatch?.[1] || 'ok',
        usagePercent: parseFloat(pctMatch[1]),
        resetInSec: resetMatch ? parseInt(resetMatch[1], 10) : 0,
      };
      if (prefix === 'rolling') result.rollingUsage = window;
      else if (prefix === 'weekly') result.weeklyUsage = window;
      else result.monthlyUsage = window;
    }
  }

  // 如果正则未匹配到，尝试 JSON 解析
  if (!result.rollingUsage && !result.weeklyUsage) {
    try {
      // 查找包含 usagePercent 的 JSON 对象
      const jsonRegex = /\{[^{}]*"?(?:usagePercent|usedPercent)"?\s*:\s*[0-9]+[^{}]*\}/g;
      // 嵌入式数据通常在 script 标签中
      const scriptRegex = /<script[^>]*>([\s\S]*?)<\/script>/gi;
      let scriptMatch;
      while ((scriptMatch = scriptRegex.exec(html)) !== null) {
        const scriptContent = scriptMatch[1];
        if (scriptContent.includes('usagePercent') || scriptContent.includes('usedPercent')) {
          // 尝试找包含 rolling/weekly/monthly 的上下文
          const windowNames = ['rollingUsage', 'weeklyUsage', 'monthlyUsage',
                              'rolling', 'weekly', 'monthly'] as const;
          for (const name of windowNames) {
            const idx = scriptContent.indexOf(name);
            if (idx === -1) continue;
            // 提取附近的对象
            const nearby = scriptContent.substring(idx, idx + 500);
            const pctM = nearby.match(PERCENT_REGEX);
            const resetM = nearby.match(RESET_REGEX);
            if (pctM) {
              const uw: UsageWindow = {
                status: 'ok',
                usagePercent: parseFloat(pctM[1]),
                resetInSec: resetM ? parseInt(resetM[1], 10) : 0,
              };
              const prefix = name.startsWith('rolling') ? 'rolling' :
                             name.startsWith('weekly') ? 'weekly' : 'monthly';
              if (prefix === 'rolling' && !result.rollingUsage) result.rollingUsage = uw;
              else if (prefix === 'weekly' && !result.weeklyUsage) result.weeklyUsage = uw;
              else if (prefix === 'monthly' && !result.monthlyUsage) result.monthlyUsage = uw;
            }
          }
        }
      }
    } catch {
      // JSON 解析失败，忽略
    }
  }

  return result;
}

/**
 * 从页面 HTML 解析 Zen 余额
 */
function parseZenBalance(html: string): number | null {
  // 正则匹配 $xx.xx 余额文本
  const patterns = [
    /(?:current\s+balance|zen\s+balance)[^$]{0,80}\$\s*([0-9][0-9,]*(?:\.[0-9]+)?)/i,
    /(?:balance)[\s\S]{0,120}?\$\s*([0-9][0-9,]*(?:\.[0-9]+)?)/i,
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) return parseFloat(match[1].replace(/,/g, ''));
  }
  return null;
}

export class OpenCodeGoProvider implements Provider {
  name = 'OpenCode Go';

  async fetchUsage(config: ProviderConfig): Promise<UsageResult> {
    const accountId = config.accountId!;
    let win: BrowserWindow | null = null;

    try {
      // 1. 加载 /go 页面获取 workspace ID
      // 选择 /go 而非主页的原因：主页是营销页不含 wrk_id；/go 路由会服务端查询
      // getLastSeenWorkspaceID 并把 /workspace/{wrk_id}/go 渲染到 CTA 链接的 href 中
      win = await createLoadedWindow(accountId, 'https://opencode.ai/go');

      const workspaceId = await getWorkspaceId(win);
      if (!workspaceId) {
        return { used: 0, total: 0, expiresAt: '', error: TOKEN_EXPIRED, details: { quotas: [] } };
      }

      console.log(`[OpenCodeGo] Found workspace: ${workspaceId}`);

      // 2. 加载 Lite 用量页面
      win.destroy();
      win = await createLoadedWindow(accountId, `https://opencode.ai/workspace/${workspaceId}/go`);

      const usageHtml = await withTimeout(win.webContents.executeJavaScript(`document.documentElement.outerHTML`));

      if (isAuthFailure(usageHtml)) {
        return { used: 0, total: 0, expiresAt: '', error: TOKEN_EXPIRED, details: { quotas: [] } };
      }

      const usageData = parseUsageFromHtml(usageHtml);

      // 3. 并行获取 Zen 余额（可选，非阻塞）
      let zenBalance: number | null = null;
      try {
        const balanceWin = await createLoadedWindow(accountId, `https://opencode.ai/workspace/${workspaceId}`, 10000);
        try {
          const balanceHtml = await withTimeout(balanceWin.webContents.executeJavaScript(`document.documentElement.outerHTML`));
          zenBalance = parseZenBalance(balanceHtml);
        } finally {
          if (!balanceWin.isDestroyed()) balanceWin.destroy();
        }
      } catch (e) {
        console.warn('[OpenCodeGo] Failed to fetch Zen balance:', e);
      }

      return this.transformResult(usageData, zenBalance);
    } catch (e) {
      console.error('[OpenCodeGo] fetchUsage error:', e);
      return { used: 0, total: 0, expiresAt: '', error: TOKEN_EXPIRED, details: { quotas: [] } };
    } finally {
      if (win && !win.isDestroyed()) win.destroy();
    }
  }

  private transformResult(usage: ParsedUsageData, zenBalance: number | null): UsageResult {
    const now = new Date();
    const quotas: QuotaItem[] = [];

    // 5小时滚动窗口（主指标）
    if (usage.rollingUsage) {
      const resetAt = new Date(now.getTime() + usage.rollingUsage.resetInSec * 1000);
      quotas.push({
        label: 'quota.opencodegoRolling',
        used: usage.rollingUsage.usagePercent,
        total: 100,
        usageRate: usage.rollingUsage.usagePercent,
        resetAt: resetAt.toISOString(),
        limitType: 'opencodego',
      });
    }

    // 周额度
    if (usage.weeklyUsage) {
      const resetAt = new Date(now.getTime() + usage.weeklyUsage.resetInSec * 1000);
      quotas.push({
        label: 'quota.opencodegoWeekly',
        used: usage.weeklyUsage.usagePercent,
        total: 100,
        usageRate: usage.weeklyUsage.usagePercent,
        resetAt: resetAt.toISOString(),
        limitType: 'opencodego',
      });
    }

    // 月额度
    if (usage.monthlyUsage) {
      const resetAt = new Date(now.getTime() + usage.monthlyUsage.resetInSec * 1000);
      quotas.push({
        label: 'quota.opencodegoMonthly',
        used: usage.monthlyUsage.usagePercent,
        total: 100,
        usageRate: usage.monthlyUsage.usagePercent,
        resetAt: resetAt.toISOString(),
        limitType: 'opencodego',
      });
    }

    // Zen 余额
    if (zenBalance !== null) {
      quotas.push({
        label: 'quota.opencodegoZenBalance',
        used: zenBalance,
        total: zenBalance,
        usageRate: 0,
        resetAt: '',
        hideBar: true,
        currency: 'USD',
      });
    }

    // 主指标取最高使用率窗口
    const primaryPercent = Math.max(
      usage.rollingUsage?.usagePercent ?? 0,
      usage.weeklyUsage?.usagePercent ?? 0,
      usage.monthlyUsage?.usagePercent ?? 0,
    );

    const details: Record<string, unknown> = { quotas };

    if (zenBalance !== null) {
      details.balance = {
        total: `$${zenBalance.toFixed(2)}`,
        gift: '$0.00',
        cash: `$${zenBalance.toFixed(2)}`,
        frozen: '$0.00',
        currency: 'USD',
      };
    }

    return {
      used: primaryPercent,
      total: 100,
      expiresAt: '',
      level: undefined,
      details,
    };
  }
}
