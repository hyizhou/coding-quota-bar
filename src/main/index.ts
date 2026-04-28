import { app, BrowserWindow } from 'electron';
import * as fs from 'node:fs';
import * as path from 'path';
import { TrayManager } from './tray';
import { ProviderLoader } from './loader';
import { Scheduler, createScheduler } from './scheduler';
import { ConfigManager } from './config';
import { setLocale } from './i18n';
import {
  setPopupManagerDeps,
  createPopupWindow,
  openSettings,
  onTrayMouseEnter,
  onTrayMouseLeave,
  onTrayClick,
  destroyPopupWindow,
  getPopupWindow,
  isPopupVisibleNow,
} from './popup-manager';
import {
  setUpdateManagerDeps,
  initAutoUpdaterEvents,
  initMockUpdate,
  startAutoUpdateChecker,
  stopAutoUpdateChecker,
} from './update-manager';
import {
  setDeepseekAuthDeps,
  deepseekRefreshToken,
} from './deepseek-auth';
import {
  setDataTransformDeps,
  buildUsageData,
} from './data-transform';
import {
  setIpcHandlersDeps,
  setupIpcHandlers,
} from './ipc-handlers';

// 加载 .env 文件
const envPath = path.join(__dirname, '..', '..', '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf-8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/);
    if (match && !(match[1] in process.env)) {
      process.env[match[1]] = match[2].trim().replace(/^["']|["']$/g, '');
    }
  }
  console.log('[App] Loaded .env from', envPath);
}

const isDev = process.env.CQB_DEV === '1';
const mockUpdate = process.env.CQB_MOCK_UPDATE === '1';
console.log('[App] DEV mode:', isDev, '| Mock update:', mockUpdate);

// 全局模块实例
let trayManager: TrayManager | null = null;
let configManager: ConfigManager | null = null;
let scheduler: Scheduler | null = null;

/**
 * 初始化应用
 */
async function initialize(): Promise<void> {
  console.log('[App] Initializing...');

  // 1. 初始化配置管理器
  configManager = new ConfigManager();
  const config = await configManager.initialize();

  // 初始化 i18n
  if (config.language) {
    setLocale(config.language);
  }

  // 2. 注入依赖到各子模块
  const getConfigManager = () => configManager;
  const getScheduler = () => scheduler;
  const getTrayManager = () => trayManager;

  setPopupManagerDeps({ getTrayManager, getConfigManager });
  setUpdateManagerDeps({ getConfigManager, getPopupWindow: getPopupWindow });
  setDeepseekAuthDeps({ getConfigManager, getPopupWindow: getPopupWindow });
  setDataTransformDeps({ getConfigManager, getScheduler });
  setIpcHandlersDeps({ getConfigManager, getScheduler });

  // 3. 初始化 autoUpdater 事件监听
  initAutoUpdaterEvents();

  // 4. 创建托盘管理器
  trayManager = new TrayManager();
  trayManager.setCallbacks({
    onRefresh: () => {
      scheduler?.refresh().catch((error) => {
        console.error('[App] Manual refresh failed:', error);
      });
    },
    onSettings: () => {
      openSettings();
    },
    onAutoStartToggle: (enabled) => {
      if (configManager) {
        configManager.updateConfig({ autoStart: enabled }).catch((error) => {
          console.error('[App] Failed to update auto-start config:', error);
        });
      }
    },
    onCheckUpdate: () => {
      openSettings({ checkUpdate: true });
    },
    onQuit: () => {
      app.quit();
    }
  });
  trayManager.onMouseEnter(() => onTrayMouseEnter());
  trayManager.onMouseLeave(() => onTrayMouseLeave());
  trayManager.onClick(() => onTrayClick());

  // 5. 预创建弹出窗口
  if (config.memorySavingMode !== true) {
    createPopupWindow();
  }

  // 6. 创建调度器
  scheduler = createScheduler(config);
  scheduler.setTrayManager(trayManager);
  scheduler.setDisplayRule(config.trayDisplayRule ?? 'lowest');

  // 7. 加载 Provider
  const providers = ProviderLoader.loadProviders(config.providers);
  scheduler.setProviders(providers);
  console.log(`[App] Loaded ${providers.length} provider(s)`);

  // 8. 启动定时刷新
  trayManager.startLoading();

  let isAutoRefreshingToken = false;

  scheduler.on('refreshed', async () => {
    trayManager?.stopLoading();

    // 自动刷新 DeepSeek token
    if (!isAutoRefreshingToken) {
      const aggregated = scheduler!.getAggregatedData();
      if (aggregated) {
        const expiredAccounts: string[] = [];
        for (const [key, result] of aggregated.results) {
          if (key.startsWith('deepseek:') && result.error === 'TOKEN_EXPIRED') {
            const accountId = key.split(':')[1];
            expiredAccounts.push(accountId);
          }
        }
        if (expiredAccounts.length > 0) {
          isAutoRefreshingToken = true;
          let anyRefreshed = false;
          try {
            for (const accountId of expiredAccounts) {
              const ok = await deepseekRefreshToken(accountId);
              if (ok) anyRefreshed = true;
            }
          } finally {
            isAutoRefreshingToken = false;
          }
          if (anyRefreshed) return;
        }
      }
    }

    // 推送数据到渲染进程
    const data = buildUsageData();
    const popup = getPopupWindow();
    if (popup && !popup.isDestroyed()) {
      popup.webContents.send('usage-data-updated', data);
    }
  });
  scheduler.start();

  // 9. 设置开机自启
  updateAutoStart(config.autoStart);

  // 10. 监听配置变化
  setupConfigListeners();

  // 11. 设置 IPC 通信
  setupIpcHandlers();

  // 12. 启动自动更新检查
  if (mockUpdate) {
    initMockUpdate();
  }
  startAutoUpdateChecker();

  console.log('[App] Initialization complete');
}

/**
 * 设置配置变化监听
 */
function setupConfigListeners(): void {
  if (!configManager || !scheduler) return;

  configManager.on('changed', async (newConfig, oldConfig) => {
    console.log('[App] Configuration changed, updating...');

    // 更新语言
    if (newConfig.language && newConfig.language !== oldConfig?.language) {
      setLocale(newConfig.language);
      trayManager?.rebuildMenu();
    }

    // 仅在影响数据获取的配置变化时才刷新
    const needsRefresh =
      JSON.stringify(newConfig.providers) !== JSON.stringify(oldConfig?.providers) ||
      newConfig.refreshInterval !== oldConfig?.refreshInterval ||
      JSON.stringify(newConfig.display.colorThresholds) !== JSON.stringify(oldConfig?.display?.colorThresholds);

    // 更新图标显示规则
    if (newConfig.trayDisplayRule !== oldConfig?.trayDisplayRule) {
      scheduler!.setDisplayRule(newConfig.trayDisplayRule ?? 'lowest');
    }

    if (needsRefresh) {
      const intervalChanged = scheduler!.setRefreshInterval(newConfig.refreshInterval * 1000);
      scheduler!.setColorThresholds(newConfig.display.colorThresholds);

      const providers = ProviderLoader.loadProviders(newConfig.providers);
      scheduler!.setProviders(providers);
      console.log(`[App] Reloaded ${providers.length} provider(s)`);

      if (!intervalChanged) {
        scheduler!.refresh().catch((error) => {
          console.error('[App] Refresh after config change failed:', error);
        });
      }
    }

    // 更新开机自启
    updateAutoStart(newConfig.autoStart);

    // 内存节省模式变化
    if (newConfig.memorySavingMode !== oldConfig?.memorySavingMode) {
      if (newConfig.memorySavingMode && !isPopupVisibleNow()) {
        destroyPopupWindow();
        console.log('[App] Memory saving mode enabled, destroyed hidden window');
      } else if (!newConfig.memorySavingMode && !getPopupWindow()) {
        createPopupWindow();
        console.log('[App] Memory saving mode disabled, pre-created window');
      }
    }

    // 自动更新检查开关变化
    if (newConfig.autoCheckUpdate !== oldConfig?.autoCheckUpdate) {
      stopAutoUpdateChecker();
      if (newConfig.autoCheckUpdate) {
        startAutoUpdateChecker();
      }
    }
  });
}

/**
 * 设置开机自启
 */
function updateAutoStart(enabled: boolean): void {
  if (!app.isPackaged) {
    console.log('[App] Auto-start skipped: running in development mode');
    return;
  }
  app.setLoginItemSettings({
    openAtLogin: enabled,
    openAsHidden: true
  });
  console.log(`[App] Auto-start: ${enabled ? 'enabled' : 'disabled'}`);
  trayManager?.setAutoStart(enabled);
}

/**
 * Electron app 就绪
 */
app.whenReady().then(() => {
  initialize().catch((error) => {
    console.error('[App] Initialization failed:', error);
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createPopupWindow();
    }
  });
});

/**
 * 所有窗口关闭时退出 (macOS 除外)
 */
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    // 保持托盘运行，不退出
  }
});

/**
 * 应用退出前清理
 */
app.on('before-quit', () => {
  console.log('[App] Cleaning up...');

  stopAutoUpdateChecker();
  scheduler?.destroy();
  trayManager?.destroy();
  configManager?.destroy();
});

console.log('Coding Quota Bar started');
