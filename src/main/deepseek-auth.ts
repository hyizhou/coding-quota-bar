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
 * DeepSeek 网页登录：弹出 BrowserWindow 让用户登录，提取 session token
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

    // 检查并保存 token
    async function checkAndSaveToken(): Promise<boolean> {
      if (resolved || win.isDestroyed()) return false;
      try {
        const tokenJson = await win.webContents.executeJavaScript(
          `localStorage.getItem('userToken')`
        );
        if (!tokenJson) return false;

        const parsed = JSON.parse(tokenJson);
        const token = parsed?.value;
        if (!token) return false;

        resolved = true;

        if (_getConfigManager()) {
          const config = _getConfigManager()!.getConfig();
          if (config) {
            const providers = structuredClone(config.providers);
            const ds = providers.deepseek as ProviderTypeConfig;
            if (ds?.accounts) {
              const account = ds.accounts.find(a => a.id === accountId);
              if (account) {
                account.webToken = token;
                account.authMode = 'weblogin';
                account.webUserAgent = win.webContents.getUserAgent();
                await _getConfigManager()!.updateConfig({ providers });
              }
            }
          }
        }

        win.close();
        loginWindows.delete(accountId);

        const popup = _getPopupWindow();
        if (popup && !popup.isDestroyed()) {
          popup.webContents.send('deepseek-web-login-success', accountId);
        }

        resolve({ success: true });
        return true;
      } catch {
        return false;
      }
    }

    // 页面加载完成后立即检查 token
    win.webContents.on('did-finish-load', () => {
      checkAndSaveToken();
    });

    // 轮询检查（兜底）
    const checkInterval = setInterval(() => {
      if (win.isDestroyed()) {
        clearInterval(checkInterval);
        loginWindows.delete(accountId);
        if (!resolved) resolve({ success: false, error: 'Window closed' });
        return;
      }
      checkAndSaveToken();
    }, 1000);

    win.on('closed', () => {
      clearInterval(checkInterval);
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
