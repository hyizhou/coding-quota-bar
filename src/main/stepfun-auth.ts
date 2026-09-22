/**
 * StepFun 网页认证：弹窗登录（Oasis Cookie 认证，persist:stepfun-{accountId} 持久化）与登出。
 * 登录成功以 Step Plan 额度接口 2xx 判定；导航白名单限制在 stepfun.com 域内，
 * 其余跳转交系统浏览器打开。
 */
import { BrowserWindow, session, shell } from 'electron';
import type { ConfigManager } from './config';
import type { AccountConfig, ProviderTypeConfig } from '../shared/types';
import { isSafeHttpUrl } from './utils/security';

const loginWindows = new Map<string, BrowserWindow>();

const ACCOUNT_URL = 'https://platform.stepfun.com/account-overview';
const RATE_LIMIT_PATH = '/api/step.openapi.devcenter.Dashboard/QueryStepPlanRateLimit';

let _getConfigManager: () => ConfigManager | null = () => null;
let _getPopupWindow: () => BrowserWindow | null = () => null;

export function setStepfunAuthDeps(deps: {
  getConfigManager: () => ConfigManager | null;
  getPopupWindow: () => BrowserWindow | null;
}): void {
  _getConfigManager = deps.getConfigManager;
  _getPopupWindow = deps.getPopupWindow;
}

/** 通过页面内 fetch 检测登录状态：额度接口 2xx 即已登录（Cookie 自动携带） */
async function checkLoginInPage(win: BrowserWindow): Promise<boolean> {
  try {
    const result = await win.webContents.executeJavaScript(`
      fetch('${RATE_LIMIT_PATH}', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'oasis-appid': '10300',
          'oasis-platform': 'web',
          'oasis-webid': ''
        },
        body: '{}'
      }).then(r => r.ok).catch(() => false)
    `);
    return !!result;
  } catch {
    return false;
  }
}

/** 当前窗口是否停在 stepfun.com 站点上（离开站点时不做登录检测） */
function onStepfunSite(win: BrowserWindow): boolean {
  return isAllowedUrl(win.webContents.getURL());
}

/** 是否为允许站内导航的 URL（stepfun.com 及其子域，HTTPS） */
function isAllowedUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    return url.protocol === 'https:' && (url.hostname === 'stepfun.com' || url.hostname.endsWith('.stepfun.com'));
  } catch {
    return false;
  }
}

/** 更新账户的 StepFun 登录状态字段 */
async function updateAccount(accountId: string, patch: Partial<AccountConfig>): Promise<void> {
  const configManager = _getConfigManager();
  const config = configManager?.getConfig();
  if (!configManager || !config) return;

  const providers = structuredClone(config.providers);
  const stepfun = providers.stepfun as ProviderTypeConfig | undefined;
  const account = stepfun?.accounts?.find(a => a.id === accountId);
  if (!account) return;
  Object.assign(account, patch);
  await configManager.updateConfig({ providers });
}

/**
 * StepFun 网页登录：弹出 BrowserWindow 让用户登录，通过 Oasis Cookie 认证。
 * 打开时已登录则进入浏览模式：仅同步登录状态、保留窗口，不自动关闭。
 */
export function stepfunWebLogin(accountId: string): Promise<{ success: boolean; error?: string }> {
  return new Promise((resolve) => {
    const existing = loginWindows.get(accountId);
    if (existing && !existing.isDestroyed()) {
      existing.focus();
      resolve({ success: false, error: 'Login window already open' });
      return;
    }

    const partition = `persist:stepfun-${accountId}`;

    const win = new BrowserWindow({
      width: 1024,
      height: 768,
      minWidth: 480,
      minHeight: 400,
      autoHideMenuBar: true,
      title: 'StepFun Login',
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

    // 限制导航：只允许 stepfun.com 及其子域（含服务端重定向），其余跳转交系统浏览器
    const blockForeignNavigation = (event: Electron.Event, url: string): void => {
      if (!onStepfunSite(win) || !isAllowedUrl(url)) {
        event.preventDefault();
      }
    };
    win.webContents.on('will-navigate', blockForeignNavigation);
    win.webContents.on('will-redirect', blockForeignNavigation);
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (isAllowedUrl(url)) {
        return { action: 'allow' };
      }
      // 非白名单链接转系统浏览器，且仅允许网页协议，拒绝 file:// 等触发本机程序
      if (isSafeHttpUrl(url)) void shell.openExternal(url);
      return { action: 'deny' };
    });

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
      stepfunCookieSource: 'session',
      stepfunLoggedIn: true,
    });

    const notifyLoginSuccess = () => {
      const popup = _getPopupWindow();
      if (popup && !popup.isDestroyed()) {
        popup.webContents.send('stepfun-web-login-success', accountId);
      }
    };

    const onLoginSuccess = async () => {
      console.log('[StepFun] Login detected!');
      stopInterval();
      // 持久化成功后才关窗；保存失败也要结束 IPC 等待，避免登录按钮永久假死
      try {
        await saveLoginState();
      } catch (e) {
        console.warn('[StepFun] Failed to save login state:', e);
        resolved = true;
        win.close();
        loginWindows.delete(accountId);
        resolve({ success: false, error: 'Failed to save login state' });
        return;
      }
      resolved = true;
      win.close();
      loginWindows.delete(accountId);
      notifyLoginSuccess();
      resolve({ success: true });
    };

    // 页面加载后检测登录（仅当窗口停在 stepfun.com 站点时）：
    // 打开时已登录 → 浏览模式（仅同步状态，窗口保留不自动关闭）；打开后登录 → 保存状态并关闭窗口
    win.webContents.on('did-finish-load', () => {
      if (resolved || win.isDestroyed() || !onStepfunSite(win)) return;
      stopInterval();
      if (checking) return;
      checking = true;
      const atOpen = firstCheck;
      firstCheck = false;

      checkLoginInPage(win).then(async (loggedIn) => {
        checking = false;
        if (loggedIn && !resolved) {
          if (atOpen) {
            try {
              await saveLoginState();
            } catch (e) {
              // 浏览模式：同步失败保留窗口供浏览，仅结束 IPC 等待
              console.warn('[StepFun] Failed to save login state:', e);
              resolved = true;
              resolve({ success: false, error: 'Failed to save login state' });
              return;
            }
            resolved = true;
            notifyLoginSuccess();
            resolve({ success: true });
          } else {
            await onLoginSuccess();
          }
          return;
        }
        checkInterval = setInterval(async () => {
          if (resolved || win.isDestroyed() || !onStepfunSite(win)) {
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

    console.log('[StepFun] Opening login window...');
    win.loadURL(ACCOUNT_URL);
  });
}

/** StepFun 网页登出：清除登录状态与 session partition 数据 */
export async function stepfunWebLogout(accountId: string): Promise<void> {
  await updateAccount(accountId, { stepfunLoggedIn: false });
  const partition = `persist:stepfun-${accountId}`;
  const ses = session.fromPartition(partition);
  await ses.clearStorageData();
}
