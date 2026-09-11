import { BrowserWindow, session, shell } from 'electron';
import type { ConfigManager } from './config';
import type { ProviderTypeConfig } from '../shared/types';
import type { getPopupWindow as GetPopupWindowFn } from './popup-manager';

const loginWindows = new Map<string, BrowserWindow>();

let _getConfigManager: () => ConfigManager | null = () => null;
let _getPopupWindow: () => BrowserWindow | null = () => null;

export function setDeepseekAuthDeps(deps: {
  getConfigManager: () => ConfigManager | null;
  getPopupWindow: () => BrowserWindow | null;
}): void {
  _getConfigManager = deps.getConfigManager;
  _getPopupWindow = deps.getPopupWindow;
}

/**
 * DeepSeek 网页登录：弹出 BrowserWindow 让用户登录，提取 session token。
 * 打开时已登录则进入浏览模式：仅同步 token、保留窗口，不自动关闭。
 */
export function deepseekWebLogin(accountId: string): Promise<{ success: boolean; error?: string }> {
  return new Promise((resolve) => {
    const existing = loginWindows.get(accountId);
    if (existing && !existing.isDestroyed()) {
      existing.focus();
      resolve({ success: false, error: 'Login window already open' });
      return;
    }

    const partition = `persist:deepseek-${accountId}`;

    const win = new BrowserWindow({
      width: 480,
      height: 700,
      autoHideMenuBar: true,
      title: 'DeepSeek Login',
      webPreferences: {
        partition,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        // 关闭拼写检查：Windows 拼写组件在沙箱下会往 CWD 写入乱码空目录（Microsoft\Spelling）
        spellcheck: false,
      },
    });

    win.setMenuBarVisibility(false);
    loginWindows.set(accountId, win);

    // 限制导航：只允许 DeepSeek 官方域名
    const allowedOrigin = 'https://platform.deepseek.com';
    win.webContents.on('will-navigate', (event, url) => {
      if (!url.startsWith(allowedOrigin)) {
        event.preventDefault();
      }
    });
    win.webContents.setWindowOpenHandler(({ url }) => {
      shell.openExternal(url);
      return { action: 'deny' };
    });

    let resolved = false;
    // 登录模式：宽限期后仍无 token 才进入，此后检测到 token 视为用户完成登录，保存并关闭窗口
    let loginMode = false;
    let checkInterval: ReturnType<typeof setInterval> | null = null;
    const openedAt = Date.now();
    // token 由 SPA 加载后异步写入 localStorage，打开后宽限期内出现 token 一律视为"打开时已登录"
    const BROWSE_GRACE_MS = 5000;

    const stopInterval = () => {
      if (checkInterval) {
        clearInterval(checkInterval);
        checkInterval = null;
      }
    };

    /** 读取页面 localStorage 中的 session token */
    async function readToken(): Promise<string | null> {
      try {
        const tokenJson = await win.webContents.executeJavaScript(
          `localStorage.getItem('userToken')`
        );
        if (!tokenJson) return null;
        const parsed = JSON.parse(tokenJson);
        const token = parsed?.value;
        return typeof token === 'string' && token ? token : null;
      } catch {
        return null;
      }
    }

    /** 保存 token 到配置 */
    async function saveToken(token: string): Promise<void> {
      if (!_getConfigManager()) return;
      const config = _getConfigManager()!.getConfig();
      if (!config) return;
      const providers = structuredClone(config.providers);
      const ds = providers.deepseek as ProviderTypeConfig;
      if (!ds?.accounts) return;
      const account = ds.accounts.find(a => a.id === accountId);
      if (!account) return;
      account.webToken = token;
      account.authMode = 'weblogin';
      account.webUserAgent = win.webContents.getUserAgent();
      await _getConfigManager()!.updateConfig({ providers });
    }

    // 检测 token：宽限期内出现 → 浏览模式（同步 token、保留窗口）；登录模式下出现 → 保存并关闭
    async function pollToken(): Promise<void> {
      if (resolved || win.isDestroyed()) return;
      const token = await readToken();
      if (!token) return;

      if (!loginMode) {
        resolved = true;
        stopInterval();
        // 已登录：仅同步可能轮换过的 token，窗口保留供浏览
        const stored = _getConfigManager()?.getConfig()
          ?.providers?.deepseek?.accounts?.find(a => a.id === accountId)?.webToken;
        if (token !== stored) await saveToken(token);
        resolve({ success: true });
        return;
      }

      resolved = true;
      stopInterval();
      await saveToken(token);

      win.close();
      loginWindows.delete(accountId);

      const popup = _getPopupWindow();
      if (popup && !popup.isDestroyed()) {
        popup.webContents.send('deepseek-web-login-success', accountId);
      }

      resolve({ success: true });
    }

    // 页面（含登录后跳转）加载完成立即检测一次，缩短登录成功的响应延迟
    win.webContents.on('did-finish-load', () => {
      pollToken();
    });

    // 轮询检测 token，并驱动宽限期结束后切入登录模式
    checkInterval = setInterval(async () => {
      if (win.isDestroyed()) {
        stopInterval();
        loginWindows.delete(accountId);
        if (!resolved) resolve({ success: false, error: 'Window closed' });
        return;
      }
      if (!loginMode && Date.now() - openedAt >= BROWSE_GRACE_MS) loginMode = true;
      await pollToken();
    }, 1000);

    win.on('closed', () => {
      stopInterval();
      loginWindows.delete(accountId);
      if (!resolved) resolve({ success: false, error: 'Window closed' });
    });

    win.loadURL('https://platform.deepseek.com');
  });
}

/**
 * 自动刷新 DeepSeek webToken：用隐藏窗口加载页面，利用持久化 cookies 提取新 token
 */
export async function deepseekRefreshToken(accountId: string): Promise<boolean> {
  const partition = `persist:deepseek-${accountId}`;
  const win = new BrowserWindow({
    width: 480,
    height: 700,
    show: false,
    webPreferences: {
      partition,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
    },
  });

  try {
    await win.loadURL('https://platform.deepseek.com');

    // 等待 SPA 设置 localStorage 中的 token（轮询，最多 10 秒）
    let tokenJson: string | null = null;
    for (let i = 0; i < 20; i++) {
      tokenJson = await win.webContents.executeJavaScript(
        `localStorage.getItem('userToken')`
      );
      if (tokenJson) break;
      await new Promise(r => setTimeout(r, 500));
    }
    if (!tokenJson) return false;

    const parsed = JSON.parse(tokenJson);
    const token = parsed?.value;
    if (!token) return false;

    const configManager = _getConfigManager();
    if (configManager) {
      const config = configManager.getConfig();
      if (config) {
        const providers = structuredClone(config.providers);
        const ds = providers.deepseek as ProviderTypeConfig;
        if (ds?.accounts) {
          const account = ds.accounts.find(a => a.id === accountId);
          if (account) {
            account.webToken = token;
            account.authMode = 'weblogin';
            account.webUserAgent = win.webContents.getUserAgent();
            await configManager.updateConfig({ providers });
            console.log(`[DeepSeek] Auto-refreshed token for account ${accountId}`);
          }
        }
      }
    }
    return true;
  } catch (e) {
    console.warn(`[DeepSeek] Auto-refresh token failed for ${accountId}:`, e);
    return false;
  } finally {
    win.destroy();
  }
}

/**
 * DeepSeek 网页登出：清除 webToken 和 session 数据
 */
export async function deepseekWebLogout(accountId: string): Promise<void> {
  const configManager = _getConfigManager();
  if (!configManager) return;
  const config = configManager.getConfig();
  if (!config) return;

  const providers = structuredClone(config.providers);
  const ds = providers.deepseek as ProviderTypeConfig;
  if (ds?.accounts) {
    const account = ds.accounts.find(a => a.id === accountId);
    if (account) {
      account.webToken = '';
      account.authMode = 'apikey';
      await configManager.updateConfig({ providers });
    }
  }

  // 清除 session partition 数据
  const partition = `persist:deepseek-${accountId}`;
  const ses = session.fromPartition(partition);
  await ses.clearStorageData();
}
