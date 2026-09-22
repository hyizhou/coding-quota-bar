/**
 * 通用 Cookie 网页登录流程：配置驱动地创建登录窗口、轮询页内登录检测、
 * 持久化账户状态并通知渲染进程，供 MiMo/Qoder/StepFun 等会话型 Provider 复用。
 * 差异点（登录 URL、站点白名单、检测脚本、配置字段、IPC 通道）由各 Provider 以选项注入。
 */
import { BrowserWindow, session, shell } from 'electron';
import type { ConfigManager } from './config';
import type { AccountConfig, ProviderTypeConfig } from '../shared/types';
import { isSafeHttpUrl } from './utils/security';

/** 主进程依赖（由各 Provider 的 deps setter 延迟注入） */
export interface WebLoginFlowDeps {
  getConfigManager: () => ConfigManager | null;
  getPopupWindow: () => BrowserWindow | null;
}

export interface WebLoginFlowOptions<T> {
  /** partition 前缀 / config.providers 键 / 日志前缀 */
  providerKey: string;
  windowTitle: string;
  /** 登录页地址（qoder 用 arg=site 区分站点） */
  getLoginUrl(arg?: T): string;
  /** URL 是否在目标站点上：登录检测门控 + 导航白名单判定 */
  isOnSite(url: string): boolean;
  /** true 时限制 will-navigate/will-redirect 在站点白名单内；SSO 跳转无法枚举域名的设为 false */
  blockForeignNavigation: boolean;
  /** setWindowOpenHandler 的站内打开条件（不满足时网页协议链接转系统浏览器） */
  allowInAppOpen(url: string): boolean;
  /** 通过页面内 fetch 检测登录状态 */
  checkLoginInPage(win: BrowserWindow): Promise<boolean>;
  /** 登录成功后写入账户配置的字段 */
  buildLoginPatch(arg?: T): Partial<AccountConfig>;
  /** 登出后写入账户配置的字段 */
  logoutPatch: Partial<AccountConfig>;
  /** 登录成功后向渲染进程推送的 IPC 通道 */
  successChannel: string;
  /** 主进程依赖（延迟注入） */
  getDeps: () => WebLoginFlowDeps;
}

export interface WebLoginFlow<T = void> {
  login(accountId: string, arg?: T): Promise<{ success: boolean; error?: string }>;
  logout(accountId: string): Promise<void>;
}

export function createWebLoginFlow<T = void>(opts: WebLoginFlowOptions<T>): WebLoginFlow<T> {
  const tag = `[${opts.providerKey}]`;
  const loginWindows = new Map<string, BrowserWindow>();

  /** 更新账户的登录状态字段 */
  async function updateAccount(accountId: string, patch: Partial<AccountConfig>): Promise<void> {
    const deps = opts.getDeps();
    const configManager = deps.getConfigManager();
    const config = configManager?.getConfig();
    if (!configManager || !config) return;

    const providers = structuredClone(config.providers);
    const provider = providers[opts.providerKey] as ProviderTypeConfig | undefined;
    const account = provider?.accounts?.find(a => a.id === accountId);
    if (!account) return;
    Object.assign(account, patch);
    await configManager.updateConfig({ providers });
  }

  function login(accountId: string, arg?: T): Promise<{ success: boolean; error?: string }> {
    const deps = opts.getDeps();
    return new Promise((resolve) => {
      const existing = loginWindows.get(accountId);
      if (existing && !existing.isDestroyed()) {
        existing.focus();
        resolve({ success: false, error: 'Login window already open' });
        return;
      }

      const partition = `persist:${opts.providerKey}-${accountId}`;

      const win = new BrowserWindow({
        width: 1024,
        height: 768,
        minWidth: 480,
        minHeight: 400,
        autoHideMenuBar: true,
        title: opts.windowTitle,
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

      // 限制导航在站点白名单内（含服务端重定向），其余跳转交系统浏览器
      if (opts.blockForeignNavigation) {
        const blockForeignNavigation = (event: Electron.Event, url: string): void => {
          if (!opts.isOnSite(win.webContents.getURL()) || !opts.isOnSite(url)) {
            event.preventDefault();
          }
        };
        win.webContents.on('will-navigate', blockForeignNavigation);
        win.webContents.on('will-redirect', blockForeignNavigation);
      }
      win.webContents.setWindowOpenHandler(({ url }) => {
        if (opts.allowInAppOpen(url)) {
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

      const saveLoginState = () => updateAccount(accountId, opts.buildLoginPatch(arg));

      const notifyLoginSuccess = () => {
        const popup = deps.getPopupWindow();
        if (popup && !popup.isDestroyed()) {
          popup.webContents.send(opts.successChannel, accountId);
        }
      };

      const onLoginSuccess = async () => {
        console.log(`${tag} Login detected!`);
        stopInterval();
        // 持久化成功后才关窗；保存失败也要结束 IPC 等待，避免登录按钮永久假死
        try {
          await saveLoginState();
        } catch (e) {
          console.warn(`${tag} Failed to save login state:`, e);
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

      // 页面加载后检测登录（仅当窗口停在目标站点时）：
      // 打开时已登录 → 浏览模式（仅同步状态，窗口保留不自动关闭）；打开后登录 → 保存状态并关闭窗口
      win.webContents.on('did-finish-load', () => {
        if (resolved || win.isDestroyed() || !opts.isOnSite(win.webContents.getURL())) return;
        stopInterval();
        if (checking) return;
        checking = true;
        const atOpen = firstCheck;
        firstCheck = false;

        opts.checkLoginInPage(win).then(async (loggedIn) => {
          checking = false;
          if (loggedIn && !resolved) {
            if (atOpen) {
              try {
                await saveLoginState();
              } catch (e) {
                // 浏览模式：同步失败保留窗口供浏览，仅结束 IPC 等待
                console.warn(`${tag} Failed to save login state:`, e);
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
          // 未登录则轮询检测（窗口离开站点时暂停）
          checkInterval = setInterval(async () => {
            if (resolved || win.isDestroyed() || !opts.isOnSite(win.webContents.getURL())) {
              stopInterval();
              return;
            }
            const ok = await opts.checkLoginInPage(win);
            if (ok && !resolved) await onLoginSuccess();
          }, 2000);
        });
      });

      win.on('closed', () => {
        if (checkInterval) clearInterval(checkInterval);
        loginWindows.delete(accountId);
        if (!resolved) resolve({ success: false, error: 'Window closed' });
      });

      console.log(`${tag} Opening login window...`);
      win.loadURL(opts.getLoginUrl(arg));
    });
  }

  /** 登出：清除登录状态与 session partition 数据 */
  async function logout(accountId: string): Promise<void> {
    await updateAccount(accountId, opts.logoutPatch);
    const partition = `persist:${opts.providerKey}-${accountId}`;
    const ses = session.fromPartition(partition);
    await ses.clearStorageData();
  }

  return { login, logout };
}
