import { ipcMain, app, shell } from 'electron';
import { autoUpdater } from 'electron-updater';
import type { ConfigManager } from './config';
import type { Scheduler } from './scheduler';
import type { ConcurrencyTestConfig, ProviderTypeConfig } from '../shared/types';
import { ConcurrencyTestEngine } from './concurrency-test';
import { DeepSeekProvider } from '../providers/deepseek';
import { getAvailableProviderKeys } from './loader';
import { buildUsageData } from './data-transform';
import {
  showPopupWindow,
  getPopupWindow,
  setWindowLocked,
  attachBlurHandler,
  detachBlurHandler,
  getPopupMode,
  notifyHoverState,
  destroyPopupWindow,
  showFeedbackWindow,
} from './popup-manager';
import { deepseekWebLogin, deepseekWebLogout } from './deepseek-auth';
import { checkForUpdate, downloadUpdate, getUpdateStatus } from './update-manager';

let _getConfigManager: () => ConfigManager | null = () => null;
let _getScheduler: () => Scheduler | null = () => null;

export function setIpcHandlersDeps(deps: {
  getConfigManager: () => ConfigManager | null;
  getScheduler: () => Scheduler | null;
}): void {
  _getConfigManager = deps.getConfigManager;
  _getScheduler = deps.getScheduler;
}

/**
 * 设置 IPC 通信处理器
 */
export function setupIpcHandlers(): void {
  // 监听 renderer 的鼠标悬浮状态
  ipcMain.on('popup-hover-state', (_, hovering: boolean) => {
    notifyHoverState(hovering);
  });

  // 渲染进程准备好后显示弹窗
  ipcMain.on('show-popup', () => {
    showPopupWindow('pinned');
  });

  // 窗口锁定状态切换
  ipcMain.on('set-window-pinned', (_, pinned: boolean) => {
    setWindowLocked(pinned);
    if (pinned && getPopupMode() === 'hover') {
      showPopupWindow('pinned');
    }
    if (getPopupMode() === 'pinned') {
      pinned ? detachBlurHandler() : attachBlurHandler();
    }
    getPopupWindow()?.webContents.send('window-pinned-state', pinned);
  });

  // 获取当前用量数据
  ipcMain.handle('get-usage-data', () => {
    return buildUsageData();
  });

  // 手动刷新
  ipcMain.handle('refresh-usage', async () => {
    const scheduler = _getScheduler();
    if (!scheduler) return null;
    await scheduler.refresh();
    return buildUsageData();
  });

  // 获取配置（脱敏：apiKey 只传前4后4，webToken 只传布尔值）
  ipcMain.handle('get-config', () => {
    const config = _getConfigManager()?.getConfig();
    if (!config) return null;
    const sanitized = JSON.parse(JSON.stringify(config)) as typeof config;
    for (const provider of Object.values(sanitized.providers)) {
      const accounts = (provider as any).accounts;
      if (!Array.isArray(accounts)) continue;
      for (const account of accounts) {
        if (account.apiKey && account.apiKey.length > 8) {
          account.apiKey = `${account.apiKey.slice(0, 4)}${'*'.repeat(account.apiKey.length - 8)}${account.apiKey.slice(-4)}`;
        } else if (account.apiKey) {
          account.apiKey = '*'.repeat(account.apiKey.length);
        }
        (account as any).hasWebToken = !!(account as any).webToken;
        delete (account as any).webToken;
        delete (account as any).webUserAgent;
      }
    }
    return { ...sanitized, isPackaged: app.isPackaged, updateStatus: getUpdateStatus() };
  });

  // 获取可用的 provider 列表（编译时配置）
  ipcMain.handle('get-available-providers', () => {
    return getAvailableProviderKeys();
  });

  // 更新配置
  ipcMain.handle('update-config', async (_, updates) => {
    const configManager = _getConfigManager();
    if (!configManager) return null;
    await configManager.updateConfig(updates);
    return configManager.getConfig();
  });

  // 获取应用版本号
  ipcMain.handle('get-app-version', () => {
    return app.getVersion();
  });

  // 检查更新
  ipcMain.handle('check-for-update', async () => {
    await checkForUpdate();
  });

  // 下载更新
  ipcMain.handle('download-update', async () => {
    await downloadUpdate();
  });

  // 重启并安装更新
  ipcMain.handle('quit-and-install', () => {
    destroyPopupWindow();
    autoUpdater.quitAndInstall();
  });

  // 用系统浏览器打开链接
  ipcMain.handle('open-external', async (_, url: string) => {
    await shell.openExternal(url);
  });

  // 并发测试：启动
  ipcMain.handle('concurrency-test-start', async (_, config: ConcurrencyTestConfig) => {
    const cfg = _getConfigManager()?.getConfig();
    if (!cfg) throw new Error('Config not loaded');

    const providerConfig = cfg.providers[config.providerKey] as ProviderTypeConfig | undefined;
    const account = providerConfig?.accounts?.find(a => a.enabled && a.apiKey?.trim());
    if (!account?.apiKey) throw new Error('No API key configured');

    return ConcurrencyTestEngine.run(config, account.apiKey, (info) => {
      const popup = getPopupWindow();
      if (popup && !popup.isDestroyed()) {
        popup.webContents.send('concurrency-test-progress', info);
      }
    }, (info) => {
      const popup = getPopupWindow();
      if (popup && !popup.isDestroyed()) {
        popup.webContents.send('concurrency-test-stream', info);
      }
    }, (info) => {
      const popup = getPopupWindow();
      if (popup && !popup.isDestroyed()) {
        popup.webContents.send('concurrency-test-first-content', info);
      }
    });
  });

  // 并发测试：获取历史记录
  ipcMain.handle('concurrency-test-history', async (_, providerKey: string) => {
    return ConcurrencyTestEngine.loadHistory(providerKey);
  });

  // 并发测试：删除历史记录
  ipcMain.handle('concurrency-test-delete', async (_, providerKey: string, id: string) => {
    await ConcurrencyTestEngine.deleteResult(providerKey, id);
  });

  // 打开反馈群窗口
  ipcMain.on('show-feedback', () => {
    console.log('[Feedback] show-feedback received');
    try {
      showFeedbackWindow();
    } catch (e) {
      console.error('[Feedback] Error:', e);
    }
  });

  // DeepSeek 网页登录
  ipcMain.handle('deepseek-web-login', async (_, accountId: string) => {
    return await deepseekWebLogin(accountId);
  });

  // DeepSeek 网页登出
  ipcMain.handle('deepseek-web-logout', async (_, accountId: string) => {
    await deepseekWebLogout(accountId);
  });

  // DeepSeek 按月获取模型历史数据
  ipcMain.handle('deepseek-fetch-month-usage', async (_, accountId: string, year: number, month: number) => {
    const scheduler = _getScheduler() as any;
    const loaded = scheduler?.providers as import('./loader').LoadedProvider[] | undefined;
    const empty = { tokens: [], costs: [] };
    if (!loaded) return empty;
    const provider = loaded.find((p: any) => p.accountId === accountId && p.instance instanceof DeepSeekProvider);
    if (!provider) return empty;
    try {
      return await (provider.instance as DeepSeekProvider).fetchMonthModelHistory(provider.config, month, year);
    } catch (e) {
      console.warn('[DeepSeek] Failed to fetch month usage:', e);
      return empty;
    }
  });
}
