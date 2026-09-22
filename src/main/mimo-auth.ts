/**
 * MiMo 网页认证：弹窗登录（Cookie 认证，persist:mimo-{accountId} 持久化）与登出。
 * 导航白名单限制在 MiMo 及小米 SSO 域名内，其余跳转交系统浏览器打开。
 * 流程实现在 web-login-flow.ts。
 */
import type { BrowserWindow } from 'electron';
import { createWebLoginFlow, type WebLoginFlowDeps } from './web-login-flow';

/** MiMo 及小米 SSO 允许域（精确 host 匹配，防前缀伪造域名） */
const ALLOWED_MIMO_HOSTS = new Set([
  'platform.xiaomimimo.com',
  'xiaomimimo.com',
  'account.xiaomi.com',
  'login.xiaomi.com',
  'passport.xiaomi.com',
]);

let deps: WebLoginFlowDeps = {
  getConfigManager: () => null,
  getPopupWindow: () => null,
};

export function setMimoAuthDeps(next: WebLoginFlowDeps): void {
  deps = next;
}

/** 是否为允许站内导航的 URL（HTTPS + 白名单域名） */
function isMimoUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && ALLOWED_MIMO_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
}

/** 通过页面内 fetch 检测 MiMo 登录状态（Cookie 天然携带） */
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

const flow = createWebLoginFlow({
  providerKey: 'mimo',
  windowTitle: 'MiMo Login',
  getLoginUrl: () => 'https://platform.xiaomimimo.com/console/balance',
  isOnSite: isMimoUrl,
  blockForeignNavigation: true,
  allowInAppOpen: isMimoUrl,
  checkLoginInPage,
  buildLoginPatch: () => ({
    authMode: 'weblogin',
    mimoLoggedIn: true,
  }),
  logoutPatch: { authMode: 'apikey', mimoLoggedIn: false },
  successChannel: 'mimo-web-login-success',
  getDeps: () => deps,
});

/** MiMo 网页登录：打开时已登录则进入浏览模式（仅同步登录状态、保留窗口） */
export function mimoWebLogin(accountId: string): Promise<{ success: boolean; error?: string }> {
  return flow.login(accountId);
}

/** MiMo 网页登出：清除登录状态与 session partition 数据 */
export function mimoWebLogout(accountId: string): Promise<void> {
  return flow.logout(accountId);
}
