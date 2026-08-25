import { contextBridge, ipcRenderer } from 'electron';
import type { WindowPinMode } from '../shared/types';

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
   * 设置窗口固定状态（不固定 / 固定置顶 / 固定不置顶）
   */
  setWindowPinned: (mode: WindowPinMode) => {
    ipcRenderer.send('set-window-pinned', mode);
  },

  /**
   * 监听窗口固定状态变化
   */
  onWindowPinnedState: (callback: (mode: WindowPinMode) => void) => {
    ipcRenderer.on('window-pinned-state', (_, mode) => callback(mode));
  },

  openExternal: (url: string) => ipcRenderer.invoke('open-external', url),

  /**
   * 测试 provider 连接（设置页"测试连接"按钮用）
   *  - 传 accountId：用已保存的 key 测试（无需先保存）
   *  - 传 apiKey：直接用新填的 key 测试
   */
  testProviderConnection: (params: {
    providerKey: string
    accountId?: string
    apiKey?: string
    authMode?: 'apikey' | 'weblogin'
    webToken?: string
    webUserAgent?: string
  }) => ipcRenderer.invoke('test-provider-connection', params),

  /**
   * 导出配置（设置页"导出配置"按钮）
   * @param options.sanitize true=脱敏(默认)，false=含完整 key
   */
  exportConfig: (options?: { sanitize?: boolean }) => ipcRenderer.invoke('export-config', options),

  /**
   * 选择配置文件并读取，返回解析后的 config 让 UI 确认（不直接写）
   */
  importConfig: () => ipcRenderer.invoke('import-config'),

  /**
   * 用户确认后真正写入导入的 config
   */
  confirmImportConfig: (data: any) => ipcRenderer.invoke('confirm-import-config', data),

  /**
   * === Tier 3: 诊断 ===
   */
  getConfigPath: () => ipcRenderer.invoke('get-config-path'),
  reloadConfig: () => ipcRenderer.invoke('reload-config'),
  openConfigFolder: () => ipcRenderer.invoke('open-config-folder'),

  /**
   * === 错误日志（Tier 3 polish）===
   */
  reportRendererError: (payload: { message: string; stack?: string; source?: string }) => {
    ipcRenderer.send('renderer-error', payload)
  },
  getRendererLog: () => ipcRenderer.invoke('get-renderer-log'),
  openRendererLog: () => ipcRenderer.invoke('open-renderer-log'),

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
  onConcurrencyTestProgress: (callback: (progress: { index: number; total: number; success: boolean; ttftMs: number; totalMs: number; tokenCount: number; tokensPerSec: number; error?: string }) => void) => {
    const handler = (_: any, data: any) => callback(data);
    (callback as any).__ipcHandler = handler;
    ipcRenderer.on('concurrency-test-progress', handler);
  },

  /**
   * 并发测试：取消监听进度
   */
  offConcurrencyTestProgress: (callback: (progress: { index: number; total: number; success: boolean }) => void) => {
    const handler = (callback as any).__ipcHandler;
    if (handler) ipcRenderer.removeListener('concurrency-test-progress', handler);
  },

  /**
   * 并发测试：监听实时文字流
   */
  onConcurrencyTestStream: (callback: (info: { index: number; text: string }) => void) => {
    const handler = (_: any, data: any) => callback(data);
    (callback as any).__ipcStreamHandler = handler;
    ipcRenderer.on('concurrency-test-stream', handler);
  },

  /**
   * 并发测试：取消监听文字流
   */
  offConcurrencyTestStream: (callback: (info: { index: number; text: string }) => void) => {
    const handler = (callback as any).__ipcStreamHandler;
    if (handler) ipcRenderer.removeListener('concurrency-test-stream', handler);
  },

  /**
   * 并发测试：监听首字到达
   */
  onConcurrencyTestFirstContent: (callback: (info: { index: number; total: number }) => void) => {
    const handler = (_: any, data: any) => callback(data);
    (callback as any).__ipcFirstContentHandler = handler;
    ipcRenderer.on('concurrency-test-first-content', handler);
  },

  /**
   * 并发测试：取消监听首字到达
   */
  offConcurrencyTestFirstContent: (callback: (info: { index: number; total: number }) => void) => {
    const handler = (callback as any).__ipcFirstContentHandler;
    if (handler) ipcRenderer.removeListener('concurrency-test-first-content', handler);
  },

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
  onDeepseekWebLoginSuccess: (callback: (accountId: string) => void) => {
    ipcRenderer.on('deepseek-web-login-success', (_, accountId) => callback(accountId));
  },
  deepseekFetchMonthUsage: (accountId: string, year: number, month: number) =>
    ipcRenderer.invoke('deepseek-fetch-month-usage', accountId, year, month),

  /**
   * MiMo 网页登录
   */
  mimoWebLogin: (accountId: string) => ipcRenderer.invoke('mimo-web-login', accountId),
  mimoWebLogout: (accountId: string) => ipcRenderer.invoke('mimo-web-logout', accountId),
  onMimoWebLoginSuccess: (callback: (accountId: string) => void) => {
    ipcRenderer.on('mimo-web-login-success', (_, accountId) => callback(accountId));
  },

  /**
   * MiMo 按月获取模型历史数据
   */
  mimoFetchMonthUsage: (accountId: string, year: number, month: number) =>
    ipcRenderer.invoke('mimo-fetch-month-usage', accountId, year, month),
});
