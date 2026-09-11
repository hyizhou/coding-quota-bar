/**
 * Qoder Provider：复用官网登录会话读取 big model credits 额度。
 * 双模式凭据：session（弹窗登录，persist:qoder-{accountId} 持久化 Cookie，隐藏窗口页内 fetch）
 * 与 manual（设置页粘贴 Cookie 头/cURL/HTTP 请求，主进程 HttpClient 携带 §6 请求头）。
 * 协议规范：docs/qoder/Qoder额度获取实现指南.md
 */
import { BrowserWindow } from 'electron';
import { HttpClient } from '../main/http';
import type { Provider, ProviderConfig, UsageResult } from '../shared/types';
import {
  QODER_API_PATH,
  QODER_BROWSER_UA,
  QODER_BX_V,
  QODER_SITES,
  parseManualCapture,
  parseQoderUsageBody,
  type QoderSite,
} from './qoder-protocol';

const TOKEN_EXPIRED = 'TOKEN_EXPIRED';

/** 请求/页面加载超时（协议文档 §6：默认 15 秒） */
const REQUEST_TIMEOUT = 15000;

/** 页内 fetch 超时：防止 executeJavaScript 永久挂起导致窗口无法销毁 */
const PAGE_FETCH_TIMEOUT = 15000;

function withTimeout<T>(promise: Promise<T>, ms: number = PAGE_FETCH_TIMEOUT): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('Page fetch timeout')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  }) as Promise<T>;
}

function errorResult(error: string): UsageResult {
  return { used: 0, total: 0, expiresAt: '', error, details: { quotas: [] } };
}

/** 把 API 响应映射为 UsageResult：401/403 会话失效，其他非 2xx 为 apiError，解析失败单独标记 */
function mapApiResponse(status: number, body: string): UsageResult {
  if (status === 401 || status === 403) return errorResult(TOKEN_EXPIRED);
  if (status < 200 || status >= 300) return errorResult(`HTTP ${status}`);

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return errorResult('PARSE_FAILED');
  }
  try {
    const snapshot = parseQoderUsageBody(parsed);
    return {
      used: snapshot.usedCredits,
      total: snapshot.totalCredits,
      expiresAt: '',
      // 协议解析保证 total=0 时 used/remaining 必为 0（否则抛错），此处即"无套餐账户"
      noQuota: snapshot.totalCredits === 0,
      details: {
        quotas: [{
          label: 'quota.qoderCredits',
          used: snapshot.usedCredits,
          total: snapshot.totalCredits,
          // 无套餐时统一显示 100%（红色），与托盘 0% 剩余保持一致
          usageRate: snapshot.totalCredits === 0 ? 100 : snapshot.usagePercentage,
          resetAt: snapshot.resetsAt ?? '',
        }],
        qoderRemaining: snapshot.remainingCredits,
        qoderUnit: snapshot.unit,
      },
    };
  } catch (e) {
    return errorResult(`PARSE_FAILED: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** ---------- manual 模式：主进程直接请求（§6 全套浏览器式请求头） ---------- */

async function fetchViaHttp(site: QoderSite, cookieHeader: string): Promise<UsageResult> {
  const info = QODER_SITES[site];
  try {
    const resp = await HttpClient.request(`https://${info.host}${QODER_API_PATH}`, {
      method: 'GET',
      timeout: REQUEST_TIMEOUT,
      headers: {
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'User-Agent': QODER_BROWSER_UA,
        'Origin': info.origin,
        'Referer': `${info.origin}/account/usage`,
        'X-Requested-With': 'XMLHttpRequest',
        'Bx-V': QODER_BX_V,
        'Cookie': cookieHeader,
      },
    });
    return mapApiResponse(resp.status, resp.body);
  } catch (e) {
    return errorResult(`NETWORK_ERROR: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** ---------- session 模式：隐藏窗口页内 fetch（Cookie/Origin/Referer/UA 自动携带） ---------- */

async function createLoadedWindow(site: QoderSite, accountId: string): Promise<BrowserWindow> {
  const info = QODER_SITES[site];
  const partition = `persist:qoder-${accountId}`;
  const win = new BrowserWindow({
    width: 480,
    height: 400,
    show: false,
    // spellcheck: false —— Windows 拼写组件在沙箱下会往 CWD 写入乱码空目录（Microsoft/Spelling）
    webPreferences: { partition, contextIsolation: true, nodeIntegration: false, webSecurity: true, spellcheck: false },
  });

  // 屏蔽页面 JS 的 console 输出
  win.webContents.on('console-message', () => {});

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (!win.isDestroyed()) win.destroy();
      reject(new Error('Page load timeout'));
    }, REQUEST_TIMEOUT);
    const onClosed = () => { clearTimeout(timer); reject(new Error('Window destroyed')); };
    win.once('closed', onClosed);
    win.webContents.once('did-finish-load', () => {
      clearTimeout(timer);
      win.removeListener('closed', onClosed);
      resolve();
    });
    win.loadURL(`${info.origin}/account/usage`).catch(() => {
      // 加载结果由 did-finish-load / closed / 超时 Promise 管理，吞掉 loadURL 自身的 rejection
    });
  });

  return win;
}

async function fetchInPage(win: BrowserWindow): Promise<{ status: number; body: string }> {
  const json = await withTimeout(win.webContents.executeJavaScript(`
    (function() {
      return fetch('${QODER_API_PATH}', {
        credentials: 'include',
        headers: {
          'Accept': 'application/json, text/plain, */*',
          'X-Requested-With': 'XMLHttpRequest',
          'Bx-V': '${QODER_BX_V}'
        }
      }).then(function(r) {
        return r.text().then(function(t) { return JSON.stringify({ status: r.status, body: t }); });
      });
    })()
  `));
  const parsed = JSON.parse(json) as { status: number; body: string };
  return parsed;
}

async function fetchViaSession(site: QoderSite, accountId: string): Promise<UsageResult> {
  let win: BrowserWindow | null = null;
  try {
    win = await createLoadedWindow(site, accountId);

    // 第一次请求
    const first = await fetchInPage(win);
    const firstResult = mapApiResponse(first.status, first.body);
    if (firstResult.error !== TOKEN_EXPIRED) return firstResult;

    // Cookie 可能过期，刷新页面重试一次（session partition 内自动续期非 httpOnly cookie）
    console.log(`[Qoder] Session expired for ${accountId}, reloading...`);
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, REQUEST_TIMEOUT);
      win!.webContents.once('did-finish-load', () => { clearTimeout(timer); resolve(); });
      win!.webContents.reload();
    });

    const retry = await fetchInPage(win);
    return mapApiResponse(retry.status, retry.body);
  } catch (e) {
    return errorResult(`NETWORK_ERROR: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    if (win && !win.isDestroyed()) win.destroy();
  }
}

/** ---------- Provider ---------- */

export class QoderProvider implements Provider {
  name = 'Qoder';

  async fetchUsage(config: ProviderConfig): Promise<UsageResult> {
    const accountId = config.accountId ?? '';
    const source = (config.qoderCookieSource as string) || 'session';

    if (source === 'manual') {
      const capture = parseManualCapture(config.webToken ?? '');
      // 粘贴为空或路由失败均按"会话无效"处理（协议文档 §4.2）
      if (!capture.ok || !capture.site || !capture.cookieHeader) {
        return errorResult(TOKEN_EXPIRED);
      }
      return fetchViaHttp(capture.site, capture.cookieHeader);
    }

    const site = (config.qoderSite as QoderSite) || 'international';
    return fetchViaSession(site, accountId);
  }
}
