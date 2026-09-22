/**
 * Qoder 网页认证：弹窗登录（Cookie 认证，persist:qoder-{accountId} 持久化）与登出。
 * 登录成功以用量 API 返回 2xx 判定（协议文档：会话有效性仅由服务端响应判定），
 * 不做导航白名单——Qoder 登录可能跳转第三方 SSO，域名无法预先枚举；
 * 仅拦截非网页协议的新窗口请求，防 file:// 等触发本机程序。流程实现在 web-login-flow.ts。
 */
import type { BrowserWindow } from 'electron';
import { createWebLoginFlow, type WebLoginFlowDeps } from './web-login-flow';
import { QODER_API_PATH, QODER_BX_V, QODER_SITES, parseManualCapture, type QoderSite } from '../providers/qoder-protocol';
import { isSafeHttpUrl } from './utils/security';

let deps: WebLoginFlowDeps = {
  getConfigManager: () => null,
  getPopupWindow: () => null,
};

export function setQoderAuthDeps(next: WebLoginFlowDeps): void {
  deps = next;
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

/** 当前 URL 是否停在任一 Qoder 站点上（国内/国际站 host 不同） */
function onQoderSite(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    return Object.values(QODER_SITES).some(info => info.hosts.includes(url.hostname));
  } catch {
    return false;
  }
}

const flow = createWebLoginFlow<QoderSite>({
  providerKey: 'qoder',
  windowTitle: 'Qoder Login',
  getLoginUrl: site => `${QODER_SITES[site ?? 'international'].origin}/account/usage`,
  isOnSite: onQoderSite,
  // SSO 跳转域名无法枚举，不限制导航，仅拒绝危险协议的弹窗
  blockForeignNavigation: false,
  allowInAppOpen: isSafeHttpUrl,
  checkLoginInPage,
  buildLoginPatch: site => ({
    authMode: 'weblogin',
    qoderCookieSource: 'session',
    qoderSite: site ?? 'international',
    qoderLoggedIn: true,
  }),
  logoutPatch: { qoderLoggedIn: false },
  successChannel: 'qoder-login-success',
  getDeps: () => deps,
});

/** Qoder 网页登录：打开时已登录则进入浏览模式（仅同步登录状态、保留窗口） */
export function qoderWebLogin(accountId: string, site: QoderSite): Promise<{ success: boolean; error?: string }> {
  return flow.login(accountId, site);
}

/** Qoder 网页登出：清除登录状态与 session partition 数据 */
export function qoderWebLogout(accountId: string): Promise<void> {
  return flow.logout(accountId);
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
