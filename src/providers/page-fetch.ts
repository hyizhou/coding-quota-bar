/**
 * 页内 fetch 引擎：临时隐藏窗口加载目标页面 + executeJavaScript 页内请求的通用实现，
 * 供 Cookie 会话型 Provider（StepFun/MiMo/Qoder）复用；Cookie 由 session partition 自动携带。
 */
import { BrowserWindow } from 'electron';

/** 页内请求/页面加载默认超时（ms） */
const DEFAULT_TIMEOUT_MS = 15000;

export interface LoadedWindowOptions {
  /** session partition（persist: 前缀持久化 Cookie） */
  partition: string;
  /** 要加载的页面地址 */
  url: string;
  /** 页面加载超时（ms），默认 15s */
  timeoutMs?: number;
  /** 请求拦截条件（如屏蔽小米统计域名，避免 SSL 错误噪音） */
  shouldBlockRequest?: (url: string) => boolean;
}

/** 为 Promise 加超时保护：防止 executeJavaScript 永久挂起导致窗口无法销毁 */
export function withTimeout<T>(promise: Promise<T>, ms: number = DEFAULT_TIMEOUT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('Page fetch timeout')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  }) as Promise<T>;
}

/** 创建临时隐藏窗口并等待页面加载完成（超时/关闭均以异常结束） */
export async function createLoadedWindow(opts: LoadedWindowOptions): Promise<BrowserWindow> {
  const win = new BrowserWindow({
    width: 480,
    height: 400,
    show: false,
    // spellcheck: false —— Windows 拼写组件在沙箱下会往 CWD 写入乱码空目录（Microsoft\Spelling）
    webPreferences: { partition: opts.partition, contextIsolation: true, nodeIntegration: false, webSecurity: true, spellcheck: false },
  });

  // 屏蔽无关请求（如统计域名），避免 SSL 错误噪音输出到主进程控制台
  if (opts.shouldBlockRequest) {
    win.webContents.session.webRequest.onBeforeRequest((details, callback) => {
      callback(opts.shouldBlockRequest!(details.url) ? { cancel: true } : {});
    });
  }

  // 屏蔽页面 JS 的 console 输出
  win.webContents.on('console-message', () => {});

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      // 超时前先销毁窗口，避免 reject 后窗口残留
      if (!win.isDestroyed()) win.destroy();
      reject(new Error('Page load timeout'));
    }, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const onClosed = () => { clearTimeout(timer); reject(new Error('Window destroyed')); };
    win.once('closed', onClosed);
    win.webContents.once('did-finish-load', () => {
      clearTimeout(timer);
      win.removeListener('closed', onClosed);
      resolve();
    });
    // 加载结果由 did-finish-load / closed / 超时 Promise 管理，吞掉 loadURL 自身的 rejection
    win.loadURL(opts.url).catch(() => {});
  });

  return win;
}

/** 在页面内执行脚本并带超时保护（页内 fetch 的统一入口） */
export async function execInPage<T>(win: BrowserWindow, script: string, timeoutMs: number = DEFAULT_TIMEOUT_MS): Promise<T> {
  const result = await withTimeout(win.webContents.executeJavaScript(script), timeoutMs);
  return result as T;
}

/** 重载窗口并等待加载完成（加载失败也视为完成，交给后续请求判定会话状态） */
export function waitForReload(win: BrowserWindow, timeoutMs: number = DEFAULT_TIMEOUT_MS): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Reload timeout')), timeoutMs);
    win.webContents.once('did-finish-load', () => { clearTimeout(timer); resolve(); });
    win.webContents.once('did-fail-load', () => { clearTimeout(timer); resolve(); });
    win.reload();
  });
}
