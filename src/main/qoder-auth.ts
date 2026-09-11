/**
 * Qoder 网页认证：弹窗登录（Cookie 认证，persist:qoder-{accountId} 持久化）与登出。
 * 登录成功以用量 API 返回 2xx 判定（协议文档：会话有效性仅由服务端响应判定），
 * 不做导航白名单——Qoder 登录可能跳转第三方 SSO，域名无法预先枚举。
 */
import { BrowserWindow, session } from 'electron';
import type { ConfigManager } from './config';
import type { ProviderTypeConfig } from '../shared/types';
import { QODER_API_PATH, QODER_BX_V, QODER_SITES, parseManualCapture, type QoderSite } from '../providers/qoder-protocol';

const loginWindows = new Map<string, BrowserWindow>();

let _getConfigManager: () => ConfigManager | null = () => null;
let _getPopupWindow: () => BrowserWindow | null = () => null;

export function setQoderAuthDeps(deps: {
  getConfigManager: () => ConfigManager | null;
  getPopupWindow: () => BrowserWindow | null;
}): void {
  _getConfigManager = deps.getConfigManager;
  _getPopupWindow = deps.getPopupWindow;
}

/** 通过页面内 fetch 检测登录状态：用量 API 2xx 即已登录 */
async function checkLoginInPage(win: BrowserWindow): Promise<boolean> {
  try {
    const result = await win.webContents.executeJavaScript(`
      fetch('${QODER_API_PATH}', {
        credentials: 'include',
        headers: {
          'Accept': 'application/json, text/plain, */*',
          'X-Requested-With': 'XMLHttpRequest',
          'Bx-V': '${QODER_BX_V}'
        }
      }).then(r => r.ok).catch(() => false)
    `);
    return !!result;
  } catch {
    return false;
  }
}

/** 当前窗口是否停在 Qoder 站点上（离开站点时不做登录检测） */
function onQoderSite(win: BrowserWindow): boolean {
  try {
    const url = new URL(win.webContents.getURL());
    return Object.values(QODER_SITES).some(info => info.hosts.includes(url.hostname));
  } catch {
    return false;
  }
}

/** 更新账户的 Qoder 登录状态字段 */
async function updateAccount(accountId: string, patch: Partial<import('../shared/types').AccountConfig>): Promise<void> {
  const configManager = _getConfigManager();
  const config = configManager?.getConfig();
  if (!configManager || !config) return;

  const providers = structuredClone(config.providers);
  const qoder = providers.qoder as ProviderTypeConfig | undefined;
  const account = qoder?.accounts?.find(a => a.id === accountId);
  if (!account) return;
  Object.assign(account, patch);
  await configManager.updateConfig({ providers });
}

/**
 * Qoder 网页登录：弹出 BrowserWindow 让用户登录，通过 Cookie 认证。
 * 打开时已登录则进入浏览模式：仅同步登录状态、保留窗口，不自动关闭。
 */
export function qoderWebLogin(accountId: string, site: QoderSite): Promise<{ success: boolean; error?: string }> {
  return new Promise((resolve) => {
    const existing = loginWindows.get(accountId);
    if (existing && !existing.isDestroyed()) {
      existing.focus();
      resolve({ success: false, error: 'Login window already open' });
      return;
    }

    const info = QODER_SITES[site];
    const partition = `persist:qoder-${accountId}`;

    const win = new BrowserWindow({
      width: 1024,
      height: 768,
      minWidth: 480,
      minHeight: 400,
      autoHideMenuBar: true,
      title: 'Qoder Login',
      webPreferences: {
        partition,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        // 关闭拼写检查：Windows 拼写组件在沙箱下会往 CWD 写入乱码空目录（Microsoft/Spelling）
        spellcheck: false,
      },
    });

    win.setMenuBarVisibility(false);
    loginWindows.set(accountId, win);

    let resolved = false;
    let checkInterval: ReturnType<typeof setInterval> | null = null;
    // 首次站内加载的检测结果用于区分"打开时已登录"与"打开后登录"
    let firstCheck = true;
    let checking = false;

    const stopInterval = () => {
      if (checkInterval) {
        clearInterval(checkInterval);
        checkInterval = null;
      }
    };

    const saveLoginState = () => updateAccount(accountId, {
      authMode: 'weblogin',
      qoderCookieSource: 'session',
      qoderSite: site,
      qoderLoggedIn: true,
    });

    const notifyLoginSuccess = () => {
      const popup = _getPopupWindow();
      if (popup && !popup.isDestroyed()) {
        popup.webContents.send('qoder-login-success', accountId);
      }
    };

    const onLoginSuccess = async () => {
      console.log('[Qoder] Login detected!');
      resolved = true;
      stopInterval();
      await saveLoginState();
      win.close();
      loginWindows.delete(accountId);
      notifyLoginSuccess();
      resolve({ success: true });
    };

    // 页面加载后检测登录（仅当窗口停在 Qoder 站点时）：
    // 打开时已登录 → 浏览模式（仅同步状态，窗口保留不自动关闭）；打开后登录 → 保存状态并关闭窗口
    win.webContents.on('did-finish-load', () => {
      if (resolved || win.isDestroyed() || !onQoderSite(win)) return;
      stopInterval();
      if (checking) return;
      checking = true;
      const atOpen = firstCheck;
      firstCheck = false;

      checkLoginInPage(win).then(async (loggedIn) => {
        checking = false;
        if (loggedIn && !resolved) {
          if (atOpen) {
            resolved = true;
            await saveLoginState();
            notifyLoginSuccess();
            resolve({ success: true });
          } else {
            await onLoginSuccess();
          }
          return;
        }
        checkInterval = setInterval(async () => {
          if (resolved || win.isDestroyed() || !onQoderSite(win)) {
            stopInterval();
            return;
          }
          const ok = await checkLoginInPage(win);
          if (ok && !resolved) await onLoginSuccess();
        }, 2000);
      });
    });

    win.on('closed', () => {
      if (checkInterval) clearInterval(checkInterval);
      loginWindows.delete(accountId);
      if (!resolved) resolve({ success: false, error: 'Window closed' });
    });

    console.log('[Qoder] Opening login window...');
    win.loadURL(`${info.origin}/account/usage`);
  });
}

/** Qoder 网页登出：清除登录状态与 session partition 数据 */
export async function qoderWebLogout(accountId: string): Promise<void> {
  await updateAccount(accountId, { qoderLoggedIn: false });
  const partition = `persist:qoder-${accountId}`;
  const ses = session.fromPartition(partition);
  await ses.clearStorageData();
}

/** 手动粘贴内容解析（设置页即时校验：识别站点/Cookie 数量/错误原因） */
export function qoderParseManual(text: string): {
  ok: boolean;
  site?: string;
  cookieCount?: number;
  error?: string;
} {
  const result = parseManualCapture(text);
  return {
    ok: result.ok,
    site: result.site,
    cookieCount: result.cookieCount,
    error: result.error,
  };
}
