import { contextBridge, ipcRenderer } from 'electron';

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
  onShowSettings: (callback: (options?: { checkUpdate?: boolean }) => void) => {
    ipcRenderer.on('show-settings', (_, options) => callback(options));
  },

  /**
   * 监听主进程推送的用量数据更新
   */
  onUsageDataUpdated: (callback: (data: unknown) => void) => {
    ipcRenderer.on('usage-data-updated', (_, data) => callback(data));
  },

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
   * 检查更新（仅触发，结果通过 onUpdateStatusChanged 推送）
   */
  checkForUpdate: () => ipcRenderer.invoke('check-for-update'),

  /**
   * 下载更新
   */
  downloadUpdate: () => ipcRenderer.invoke('download-update'),

  /**
   * 监听主进程推送的统一更新状态
   */
  onUpdateStatusChanged: (callback: (status: { phase: string; version?: string; progress?: number }) => void) => {
    const handler = (_: unknown, status: { phase: string; version?: string; progress?: number }) => callback(status);
    ipcRenderer.on('update-status-changed', handler);
    return () => ipcRenderer.removeListener('update-status-changed', handler);
  },

  /**
   * 重启并安装更新
   */
  quitAndInstall: () => ipcRenderer.invoke('quit-and-install'),

  /**
   * 通知主进程显示弹窗
   */
  showPopup: () => ipcRenderer.send('show-popup'),

  /**
   * 设置窗口锁定状态（防止失焦隐藏）
   */
  setWindowPinned: (pinned: boolean) => {
    ipcRenderer.send('set-window-pinned', pinned);
  },

  /**
   * 监听窗口锁定状态变化
   */
  onWindowPinnedState: (callback: (pinned: boolean) => void) => {
    ipcRenderer.on('window-pinned-state', (_, pinned) => callback(pinned));
  },

  openExternal: (url: string) => ipcRenderer.invoke('open-external', url),

  /**
   * 监听来自托盘菜单的检查更新触发事件
   */
  onTriggerCheckUpdate: (callback: () => void) => {
    ipcRenderer.on('trigger-check-update', () => callback());
  },

  /**
   * 取消监听检查更新触发事件
   */
  offTriggerCheckUpdate: (callback: () => void) => {
    ipcRenderer.removeListener('trigger-check-update', callback);
  },

  showFeedback: () => ipcRenderer.send('show-feedback'),

  /**
   * DeepSeek 网页登录
   */
  deepseekWebLogin: (accountId: string) => ipcRenderer.invoke('deepseek-web-login', accountId),
  deepseekWebLogout: (accountId: string) => ipcRenderer.invoke('deepseek-web-logout', accountId),
  onDeepseekWebLoginSuccess: (callback: (accountId: string) => void) => {
    ipcRenderer.on('deepseek-web-login-success', (_, accountId) => callback(accountId));
  },
  deepseekFetchMonthUsage: (accountId: string, year: number, month: number) =>
    ipcRenderer.invoke('deepseek-fetch-month-usage', accountId, year, month),
});
