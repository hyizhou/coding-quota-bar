/**
 * 千问 / 百炼 Token Plan 网页认证：控制台 console-login 回传 access token（与官方 bailian-cli
 * `bl auth login --console` 相同机制），登录窗口 Cookie 持久化于 persist:qwen-{accountId}。
 *
 * 流程：主进程在 127.0.0.1 随机端口起一次性回调服务 → 窗口打开
 * {控制台}/console-login?notice=127.0.0.1:{port}?state={state} → 用户登录后页面把 access_token
 * 回传到本地服务（校验 Origin 与 state）→ 网关校验 token 有效后写入 webToken（主进程加密）。
 * 会话过期时用隐藏窗口复用持久化 Cookie 静默重走一次，免去重复登录。
 */
import { BrowserWindow, session, shell } from 'electron';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http';
import { randomBytes } from 'crypto';
import type { ConfigManager } from './config';
import type { ProviderTypeConfig } from '../shared/types';
import { HttpClient } from './http';
import { isSafeHttpUrl } from './utils/security';
import {
  QWEN_API,
  buildGatewayRequest,
  extractAccessToken,
  parseGatewayResponse,
  qwenSite,
  type QwenRegion,
} from '../providers/qwen-protocol';

const loginWindows = new Map<string, BrowserWindow>();

let _getConfigManager: () => ConfigManager | null = () => null;
let _getPopupWindow: () => BrowserWindow | null = () => null;

export function setQwenAuthDeps(deps: {
  getConfigManager: () => ConfigManager | null;
  getPopupWindow: () => BrowserWindow | null;
}): void {
  _getConfigManager = deps.getConfigManager;
  _getPopupWindow = deps.getPopupWindow;
}

/** 交互登录等待上限（与官方 CLI 一致 15 分钟） */
const LOGIN_TIMEOUT_MS = 15 * 60 * 1000;
/** 静默刷新等待上限：持久化 Cookie 有效时页面加载后即回传 */
const REFRESH_TIMEOUT_MS = 20000;
/** 回传请求体上限 */
const MAX_BODY_BYTES = 64 * 1024;
/** 静默刷新失败后的冷却期：控制台 Cookie 也失效时，避免每轮定时刷新都开隐藏窗口 */
const REFRESH_COOLDOWN_MS = 30 * 60 * 1000;
const refreshFailedAt = new Map<string, number>();

function partitionOf(accountId: string): string {
  return `persist:qwen-${accountId}`;
}

function normalizeRegion(region: unknown): QwenRegion {
  return region === 'global' ? 'global' : 'cn';
}

/** 用网关校验 token：仅明确的会话失效判为无效，网络异常不阻断登录 */
async function validateToken(region: QwenRegion, token: string): Promise<boolean> {
  try {
    const req = buildGatewayRequest(region, QWEN_API.usage, token);
    const resp = await HttpClient.request(req.url, { method: 'POST', headers: req.headers, body: req.body });
    if (resp.status === 401 || resp.status === 403) return false;
    const result = parseGatewayResponse(resp.body);
    return result.ok || !result.expired;
  } catch (e) {
    console.warn('[Qwen] Token validation request failed:', e);
    return true;
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('payload too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

interface CallbackServer {
  port: number;
  state: string;
  /** 收到并校验通过的 token（服务随即关闭） */
  token: Promise<string>;
  close(): void;
}

/**
 * 启动一次性本地回调服务：仅接受控制台 Origin（或无 Origin 的顶层导航）且 state 匹配的请求，
 * 处理 CORS 预检与 Private Network Access 预检
 */
function startCallbackServer(region: QwenRegion): Promise<CallbackServer> {
  const origin = qwenSite(region).consoleOrigin;
  const state = randomBytes(16).toString('hex');
  let settle: ((token: string) => void) | null = null;
  const token = new Promise<string>((resolve) => { settle = resolve; });
  let done = false;

  const server: Server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Vary', 'Origin, Access-Control-Request-Private-Network');
      const reqOrigin = req.headers.origin;
      if (reqOrigin !== undefined && reqOrigin !== origin) {
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Origin not allowed\n');
        return;
      }
      if (reqOrigin === origin) res.setHeader('Access-Control-Allow-Origin', origin);
      if (req.method === 'OPTIONS') {
        if (reqOrigin === origin && req.headers['access-control-request-private-network'] === 'true') {
          res.setHeader('Access-Control-Allow-Private-Network', 'true');
        }
        res.writeHead(204, {
          'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        });
        res.end();
        return;
      }

      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (url.searchParams.get('state') !== state) {
        res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('bad state\n');
        return;
      }
      if (done) {
        res.writeHead(409, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Login is no longer waiting for credentials\n');
        return;
      }

      const method = req.method ?? 'GET';
      const body = method === 'POST' || method === 'PUT' || method === 'PATCH' ? await readBody(req) : '';
      const contentType = String(req.headers['content-type'] ?? '');
      const accessToken = extractAccessToken(url.searchParams, body, contentType);
      if (!accessToken) {
        res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Missing access_token\n');
        return;
      }

      done = true;
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('OK\n');
      settle?.(accessToken);
      server.close();
    } catch {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    }
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Failed to bind 127.0.0.1'));
        return;
      }
      resolve({
        port: address.port,
        state,
        token,
        close: () => {
          done = true;
          server.close();
          server.closeAllConnections?.();
        },
      });
    });
  });
}

function buildLoginUrl(region: QwenRegion, port: number, state: string): string {
  // notice 参数原样拼接第二个 '?'（控制台页面按此格式解析，与官方 CLI 一致）
  return `${qwenSite(region).consoleOrigin}/console-login?notice=127.0.0.1:${port}?state=${encodeURIComponent(state)}`;
}

/** 写入登录结果：token 存 webToken（ConfigManager 落盘时加密），同步站点区域 */
async function saveToken(accountId: string, region: QwenRegion, token: string): Promise<void> {
  const configManager = _getConfigManager();
  const config = configManager?.getConfig();
  if (!configManager || !config) throw new Error('Config not ready');
  const providers = structuredClone(config.providers);
  const qwen = providers.qwen as ProviderTypeConfig | undefined;
  const account = qwen?.accounts?.find(a => a.id === accountId);
  if (!account) throw new Error('Account not found');
  account.webToken = token;
  account.authMode = 'weblogin';
  account.region = region;
  await configManager.updateConfig({ providers });
}

/** 登录窗口：不限制 SSO 跳转域名（阿里云登录含支付宝/钉钉等第三方），仅放行网页协议 */
function createLoginWindow(accountId: string, show: boolean): BrowserWindow {
  const win = new BrowserWindow({
    width: show ? 1024 : 480,
    height: show ? 768 : 400,
    minWidth: 480,
    minHeight: 400,
    show,
    autoHideMenuBar: true,
    title: 'Qwen (Bailian) Login',
    webPreferences: {
      partition: partitionOf(accountId),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      // 关闭拼写检查：Windows 拼写组件在沙箱下会往 CWD 写入乱码空目录（Microsoft\Spelling）
      spellcheck: false,
    },
  });
  win.setMenuBarVisibility(false);
  const blockUnsafeNavigation = (event: Electron.Event, url: string): void => {
    if (!isSafeHttpUrl(url)) event.preventDefault();
  };
  win.webContents.on('will-navigate', blockUnsafeNavigation);
  win.webContents.on('will-redirect', blockUnsafeNavigation);
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (show && isSafeHttpUrl(url)) return { action: 'allow' };
    if (isSafeHttpUrl(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  if (!show) win.webContents.on('console-message', () => {});
  return win;
}

/**
 * 千问网页登录：弹出控制台登录窗口，收到回传 token 并校验有效后保存、关闭窗口。
 * 控制台已登录时页面加载即回传，窗口一闪而过。
 */
export function qwenWebLogin(accountId: string, regionArg: string): Promise<{ success: boolean; error?: string }> {
  const region = normalizeRegion(regionArg);
  return new Promise((resolve) => {
    const existing = loginWindows.get(accountId);
    if (existing && !existing.isDestroyed()) {
      existing.focus();
      resolve({ success: false, error: 'Login window already open' });
      return;
    }

    let resolved = false;
    const finish = (result: { success: boolean; error?: string }) => {
      if (resolved) return;
      resolved = true;
      resolve(result);
    };

    startCallbackServer(region).then((callback) => {
      const win = createLoginWindow(accountId, true);
      loginWindows.set(accountId, win);
      // 关窗时立即移出登记表（closed 事件异步触发），避免紧接着再次登录被误判"窗口已打开"
      const closeWindow = () => {
        if (loginWindows.get(accountId) === win) loginWindows.delete(accountId);
        if (!win.isDestroyed()) win.close();
      };

      const timer = setTimeout(() => {
        callback.close();
        closeWindow();
        finish({ success: false, error: 'Login timeout' });
      }, LOGIN_TIMEOUT_MS);

      win.on('closed', () => {
        clearTimeout(timer);
        if (loginWindows.get(accountId) === win) loginWindows.delete(accountId);
        callback.close();
        finish({ success: false, error: 'Window closed' });
      });

      callback.token.then(async (token) => {
        clearTimeout(timer);
        if (!(await validateToken(region, token))) {
          console.warn('[Qwen] Received token was rejected by the gateway');
          closeWindow();
          finish({ success: false, error: 'Invalid console token' });
          return;
        }
        // 持久化成功后才关窗；保存失败也要结束 IPC 等待，避免登录按钮永久假死
        try {
          await saveToken(accountId, region, token);
        } catch (e) {
          console.warn('[Qwen] Failed to save token:', e);
          closeWindow();
          finish({ success: false, error: 'Failed to save token' });
          return;
        }
        console.log('[Qwen] Login detected!');
        refreshFailedAt.delete(accountId);
        finish({ success: true });
        closeWindow();
        const popup = _getPopupWindow();
        if (popup && !popup.isDestroyed()) {
          popup.webContents.send('qwen-web-login-success', accountId);
        }
      });

      console.log('[Qwen] Opening login window...');
      win.loadURL(buildLoginUrl(region, callback.port, callback.state)).catch(() => {});
    }).catch((e) => {
      console.warn('[Qwen] Failed to start login callback server:', e);
      finish({ success: false, error: 'Could not bind to 127.0.0.1' });
    });
  });
}

/**
 * 静默刷新 access token：隐藏窗口复用持久化 Cookie 重走 console-login，
 * 控制台会话仍有效时页面自动回传新 token
 */
export async function qwenRefreshToken(accountId: string): Promise<boolean> {
  const account = (_getConfigManager()?.getConfig()?.providers?.qwen as ProviderTypeConfig | undefined)
    ?.accounts?.find(a => a.id === accountId);
  if (!account) return false;
  const region = normalizeRegion(account.region);
  const lastFailed = refreshFailedAt.get(accountId);
  if (lastFailed !== undefined && Date.now() - lastFailed < REFRESH_COOLDOWN_MS) return false;

  let callback: CallbackServer;
  try {
    callback = await startCallbackServer(region);
  } catch (e) {
    console.warn('[Qwen] Failed to start refresh callback server:', e);
    return false;
  }
  const win = createLoginWindow(accountId, false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), REFRESH_TIMEOUT_MS); });
    win.loadURL(buildLoginUrl(region, callback.port, callback.state)).catch(() => {});
    const token = await Promise.race([callback.token, timeout]);
    if (!token || !(await validateToken(region, token))) {
      refreshFailedAt.set(accountId, Date.now());
      return false;
    }
    await saveToken(accountId, region, token);
    refreshFailedAt.delete(accountId);
    console.log(`[Qwen] Auto-refreshed token for account ${accountId}`);
    return true;
  } catch (e) {
    console.warn(`[Qwen] Auto-refresh token failed for ${accountId}:`, e);
    refreshFailedAt.set(accountId, Date.now());
    return false;
  } finally {
    if (timer) clearTimeout(timer);
    callback.close();
    if (!win.isDestroyed()) win.destroy();
  }
}

/** 千问网页登出：清除 webToken 与 session partition 数据 */
export async function qwenWebLogout(accountId: string): Promise<void> {
  const configManager = _getConfigManager();
  const config = configManager?.getConfig();
  if (configManager && config) {
    const providers = structuredClone(config.providers);
    const account = (providers.qwen as ProviderTypeConfig | undefined)?.accounts?.find(a => a.id === accountId);
    if (account) {
      account.webToken = '';
      await configManager.updateConfig({ providers });
    }
  }
  await session.fromPartition(partitionOf(accountId)).clearStorageData();
}
