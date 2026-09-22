/**
 * StepFun 网页认证：弹窗登录（Oasis Cookie 认证，persist:stepfun-{accountId} 持久化）与登出。
 * 登录成功以 Step Plan 额度接口 2xx 判定；导航白名单限制在 stepfun.com 域内，
 * 其余跳转交系统浏览器打开。流程实现在 web-login-flow.ts。
 */
import type { BrowserWindow } from 'electron';
import { createWebLoginFlow, type WebLoginFlowDeps } from './web-login-flow';

const RATE_LIMIT_PATH = '/api/step.openapi.devcenter.Dashboard/QueryStepPlanRateLimit';

let deps: WebLoginFlowDeps = {
  getConfigManager: () => null,
  getPopupWindow: () => null,
};

export function setStepfunAuthDeps(next: WebLoginFlowDeps): void {
  deps = next;
}

/** 是否为 stepfun.com 及其子域的 HTTPS URL */
function isStepfunUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    return url.protocol === 'https:' && (url.hostname === 'stepfun.com' || url.hostname.endsWith('.stepfun.com'));
  } catch {
    return false;
  }
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

const flow = createWebLoginFlow({
  providerKey: 'stepfun',
  windowTitle: 'StepFun Login',
  getLoginUrl: () => 'https://platform.stepfun.com/account-overview',
  isOnSite: isStepfunUrl,
  blockForeignNavigation: true,
  allowInAppOpen: isStepfunUrl,
  checkLoginInPage,
  buildLoginPatch: () => ({
    authMode: 'weblogin',
    stepfunCookieSource: 'session',
    stepfunLoggedIn: true,
  }),
  logoutPatch: { stepfunLoggedIn: false },
  successChannel: 'stepfun-web-login-success',
  getDeps: () => deps,
});

/** StepFun 网页登录：打开时已登录则进入浏览模式（仅同步登录状态、保留窗口） */
export function stepfunWebLogin(accountId: string): Promise<{ success: boolean; error?: string }> {
  return flow.login(accountId);
}

/** StepFun 网页登出：清除登录状态与 session partition 数据 */
export function stepfunWebLogout(accountId: string): Promise<void> {
  return flow.logout(accountId);
}
