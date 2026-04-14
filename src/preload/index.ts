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
   * 检查更新
   */
  checkForUpdate: () => ipcRenderer.invoke('check-for-update'),

  /**
   * 下载更新
   */
  downloadUpdate: () => ipcRenderer.invoke('download-update'),

  /**
   * 监听更新下载进度
   */
  onUpdateDownloadProgress: (callback: (progress: { percent: number; transferred: number; total: number }) => void) => {
    ipcRenderer.on('update-download-progress', (_, progress) => callback(progress));
  },

  /**
   * 监听更新下载完成
   */
  onUpdateDownloaded: (callback: () => void) => {
    ipcRenderer.on('update-downloaded', () => callback());
  },

  /**
   * 重启并安装更新
   */
  quitAndInstall: () => ipcRenderer.invoke('quit-and-install'),

  /**
   * 通知主进程显示弹窗
   */
  showPopup: () => ipcRenderer.send('show-popup'),

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
  }
});
