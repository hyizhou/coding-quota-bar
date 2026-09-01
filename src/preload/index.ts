import { contextBridge, ipcRenderer } from 'electron';
import type { WindowPinMode } from '../shared/types';

type Unsubscribe = () => void;

/**
 * 统一的 IPC 订阅封装：注册监听并返回取消函数
 */
function subscribe<T>(channel: string, callback: (payload: T) => void): Unsubscribe {
  const handler = (_event: unknown, payload: T) => callback(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

/**
 * 暴露给 renderer 进程的 API
 */
contextBridge.exposeInMainWorld('electronAPI', {
  /**
   * 获取当前用量数据
   */
  getUsageData: () => ipcRenderer.invoke('get-usage-data'),

  /**
   * 手动刷新用量数据
   */
  refreshUsage: () => ipcRenderer.invoke('refresh-usage'),

  /**
   * 获取配置
   */
  getConfig: () => ipcRenderer.invoke('get-config'),

  /**
   * 更新配置
   */
  updateConfig: (updates: unknown) => ipcRenderer.invoke('update-config', updates),

  /**
   * 获取可用的 provider 列表（编译时配置）
   */
  getAvailableProviders: () => ipcRenderer.invoke('get-available-providers'),

  /**
   * 监听主进程的"显示设置"事件
   */
  onShowSettings: (callback: (options?: { checkUpdate?: boolean }) => void) =>
    subscribe('show-settings', callback),

  /**
   * 监听主进程推送的用量数据更新
   */
  onUsageDataUpdated: (callback: (data: unknown) => void) =>
    subscribe('usage-data-updated', callback),

  /**
   * 通知主进程鼠标进入/离开窗口
   */
  notifyHoverState: (hovering: boolean) => {
    ipcRenderer.send('popup-hover-state', hovering);
  },

  /**
   * 获取应用版本号
   */
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),

  /**
   * 获取构建信息（版本号 + 是否商店版）
   */
  getBuildInfo: () => ipcRenderer.invoke('get-build-info'),

  /**
   * 检查更新（仅触发，结果通过 onUpdateStatusChanged 推送）
   */
  checkForUpdate: () => ipcRenderer.invoke('check-for-update'),

  /**
   * 下载更新
   */
  downloadUpdate: () => ipcRenderer.invoke('download-update'),

  /**
   * 监听主进程推送的更新状态
   */
  onUpdateStatusChanged: (callback: (status: { phase: string; version?: string; progress?: number }) => void) =>
    subscribe('update-status-changed', callback),

  /**
   * 重启并安装更新
   */
  quitAndInstall: () => ipcRenderer.invoke('quit-and-install'),

  /**
   * 通知主进程显示弹窗
   */
  showPopup: () => ipcRenderer.send('show-popup'),

  /**
   * 设置窗口固定状态（不固定/固定置顶/固定不置顶）
   */
  setWindowPinned: (mode: WindowPinMode) => {
    ipcRenderer.send('set-window-pinned', mode);
  },

  /**
   * 监听窗口固定状态变化
   */
  onWindowPinnedState: (callback: (mode: WindowPinMode) => void) =>
    subscribe('window-pinned-state', callback),

  openExternal: (url: string) => ipcRenderer.invoke('open-external', url),

  /**
   * 测试 provider 连接（设置页"测试连接"按钮用）
   * - 传 apiKey：直接用输入框里未保存的新 key 测试
   * - 传 accountId：用 ConfigManager 已保存的凭证测试
   */
  testProviderConnection: (params: {
    providerKey: string;
    accountId?: string;
    apiKey?: string;
    authMode?: 'apikey' | 'weblogin';
    webToken?: string;
    webUserAgent?: string;
  }) => ipcRenderer.invoke('test-provider-connection', params),

  /**
   * 监听来自托盘菜单的检查更新触发事件
   */
  onTriggerCheckUpdate: (callback: () => void) =>
    subscribe('trigger-check-update', callback),

  /**
   * 并发测试：启动
   */
  concurrencyTestStart: (config: unknown) => ipcRenderer.invoke('concurrency-test-start', config),

  /**
   * 并发测试：获取历史记录
   */
  concurrencyTestGetHistory: (providerKey: string) => ipcRenderer.invoke('concurrency-test-history', providerKey),

  /**
   * 并发测试：监听进度
   */
  onConcurrencyTestProgress: (callback: (progress: { index: number; total: number; success: boolean; ttftMs: number; totalMs: number; tokenCount: number; tokensPerSec: number; error?: string }) => void) =>
    subscribe('concurrency-test-progress', callback),

  /**
   * 并发测试：监听实时文字流
   */
  onConcurrencyTestStream: (callback: (info: { index: number; text: string }) => void) =>
    subscribe('concurrency-test-stream', callback),

  /**
   * 并发测试：监听首字到达
   */
  onConcurrencyTestFirstContent: (callback: (info: { index: number; total: number }) => void) =>
    subscribe('concurrency-test-first-content', callback),

  /**
   * 并发测试：删除历史记录
   */
  concurrencyTestDelete: (providerKey: string, id: string) => ipcRenderer.invoke('concurrency-test-delete', providerKey, id),

  showFeedback: () => ipcRenderer.send('show-feedback'),

  /**
   * DeepSeek 网页登录
   */
  deepseekWebLogin: (accountId: string) => ipcRenderer.invoke('deepseek-web-login', accountId),
  deepseekWebLogout: (accountId: string) => ipcRenderer.invoke('deepseek-web-logout', accountId),
  onDeepseekWebLoginSuccess: (callback: (accountId: string) => void) =>
    subscribe('deepseek-web-login-success', callback),
  deepseekFetchMonthUsage: (accountId: string, year: number, month: number) =>
    ipcRenderer.invoke('deepseek-fetch-month-usage', accountId, year, month),

  /**
   * MiMo 网页登录
   */
  mimoWebLogin: (accountId: string) => ipcRenderer.invoke('mimo-web-login', accountId),
  mimoWebLogout: (accountId: string) => ipcRenderer.invoke('mimo-web-logout', accountId),
  onMimoWebLoginSuccess: (callback: (accountId: string) => void) =>
    subscribe('mimo-web-login-success', callback),

  /**
   * MiMo 按月获取模型历史数据
   */
  mimoFetchMonthUsage: (accountId: string, year: number, month: number) =>
    ipcRenderer.invoke('mimo-fetch-month-usage', accountId, year, month),

  /**
   * 智谱每日用量历史（用量统计页按需加载）
   */
  zhipuFetchUsageStats: (accountId: string) =>
    ipcRenderer.invoke('zhipu-fetch-usage-stats', accountId),
});
