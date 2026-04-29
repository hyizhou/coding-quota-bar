import { BrowserWindow, session, shell } from 'electron';
import type { ConfigManager } from './config';
import type { ProviderTypeConfig } from '../shared/types';

const loginWindows = new Map<string, BrowserWindow>();

let _getConfigManager: () => ConfigManager | null = () => null;
let _getPopupWindow: () => BrowserWindow | null = () => null;

export function setMimoAuthDeps(deps: {
  getConfigManager: () => ConfigManager | null;
  getPopupWindow: () => BrowserWindow | null;
}): void {
  _getConfigManager = deps.getConfigManager;
  _getPopupWindow = deps.getPopupWindow;
}

/**
 * 通过页面内 fetch 检测 MiMo 登录状态（Cookie 天然携带）
 */
async function checkLoginInPage(win: BrowserWindow): Promise<boolean> {
  try {
    const result = await win.webContents.executeJavaScript(`
      fetch('/api/v1/tokenPlan/detail', { credentials: 'include' })
        .then(r => r.json())
        .then(j => j.code === 0)
        .catch(() => false)
    `);
    return !!result;
  } catch {
    return false;
  }
}

/**
 * MiMo 网页登录：弹出 BrowserWindow 让用户登录，通过 Cookie 认证
 */
export function mimoWebLogin(accountId: string): Promise<{ success: boolean; error?: string }> {
  return new Promise((resolve) => {
    const existing = loginWindows.get(accountId);
    if (existing && !existing.isDestroyed()) {
      existing.focus();
      resolve({ success: false, error: 'Login window already open' });
      return;
    }

    const partition = `persist:mimo-${accountId}`;

    const win = new BrowserWindow({
      width: 1024,
      height: 768,
      minWidth: 480,
      minHeight: 400,
      autoHideMenuBar: true,
      title: 'MiMo Login',
      webPreferences: {
        partition,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
      },
    });

    win.setMenuBarVisibility(false);
    loginWindows.set(accountId, win);

    // 限制导航：只允许 MiMo 及小米 SSO 域名
    const allowedOrigins = [
      'https://platform.xiaomimimo.com',
      'https://xiaomimimo.com',
      'https://account.xiaomi.com',
      'https://login.xiaomi.com',
      'https://passport.xiaomi.com',
    ];
    win.webContents.on('will-navigate', (event, url) => {
      if (!allowedOrigins.some(o => url.startsWith(o))) {
        event.preventDefault();
      }
    });
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (allowedOrigins.some(o => url.startsWith(o))) {
        return { action: 'allow' };
      }
      shell.openExternal(url);
      return { action: 'deny' };
    });

    let resolved = false;
    let checkInterval: ReturnType<typeof setInterval> | null = null;

    // 登录成功后的处理
    const onLoginSuccess = async () => {
      console.log('[MiMo] Login detected!');
      resolved = true;
      if (checkInterval) clearInterval(checkInterval);

      // 保存认证状态到配置
      if (_getConfigManager()) {
        const config = _getConfigManager()!.getConfig();
        if (config) {
          const providers = structuredClone(config.providers);
          const mimo = providers.mimo as ProviderTypeConfig;
          if (mimo?.accounts) {
            const account = mimo.accounts.find(a => a.id === accountId);
            if (account) {
              account.authMode = 'weblogin';
              account.mimoLoggedIn = true;
              await _getConfigManager()!.updateConfig({ providers });
            }
          }
        }
      }

      win.close();
      loginWindows.delete(accountId);

      const popup = _getPopupWindow();
      if (popup && !popup.isDestroyed()) {
        popup.webContents.send('mimo-web-login-success', accountId);
      }

      resolve({ success: true });
    };

    // 页面加载完成后轮询检测登录
    win.webContents.on('did-finish-load', () => {
      const url = win.webContents.getURL();
      console.log(`[MiMo] did-finish-load: ${url}`);

      if (checkInterval) clearInterval(checkInterval);

      // 立即检查一次
      checkLoginInPage(win).then((loggedIn) => {
        if (loggedIn && !resolved) {
          onLoginSuccess();
          return;
        }
        // 没登录则开始轮询
        checkInterval = setInterval(async () => {
          if (resolved || win.isDestroyed()) {
            if (checkInterval) clearInterval(checkInterval);
            return;
          }
          const ok = await checkLoginInPage(win);
          if (ok) await onLoginSuccess();
        }, 2000);
      });
    });

    win.on('closed', () => {
      if (checkInterval) clearInterval(checkInterval);
      loginWindows.delete(accountId);
      if (!resolved) resolve({ success: false, error: 'Window closed' });
    });

    console.log('[MiMo] Opening login window...');
    win.loadURL('https://platform.xiaomimimo.com/console/balance');
  });
}

/**
 * MiMo 网页登出：清除 authMode 和 session 数据
 */
export async function mimoWebLogout(accountId: string): Promise<void> {
  const configManager = _getConfigManager();
  if (!configManager) return;
  const config = configManager.getConfig();
  if (!config) return;

  const providers = structuredClone(config.providers);
  const mimo = providers.mimo as ProviderTypeConfig;
  if (mimo?.accounts) {
    const account = mimo.accounts.find(a => a.id === accountId);
    if (account) {
      account.authMode = 'apikey';
      account.mimoLoggedIn = false;
      await configManager.updateConfig({ providers });
    }
  }

  // 清除 session partition 数据
  const partition = `persist:mimo-${accountId}`;
  const ses = session.fromPartition(partition);
  await ses.clearStorageData();
}
