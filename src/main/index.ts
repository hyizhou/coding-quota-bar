import './logger'; // 必须最先导入：在其余模块输出日志前完成生产环境屏蔽
import { app, BrowserWindow } from 'electron';
import * as fs from 'node:fs';
import * as path from 'path';
import { TrayManager } from './tray';
import { isStoreBuild, applyStoreDataIsolation } from './channel';
import { ProviderLoader, type LoadedProvider } from './loader';
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
  resetPopupPosition,
  resetPopupSize,
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
  setMimoAuthDeps,
} from './mimo-auth';
import {
  setQoderAuthDeps,
} from './qoder-auth';
import {
  setStepfunAuthDeps,
} from './stepfun-auth';
import {
  setDataTransformDeps,
  buildUsageData,
} from './data-transform';
import {
  setIpcHandlersDeps,
  setupIpcHandlers,
} from './ipc-handlers';

// 商店版（MSIX）数据隔离：必须在任何模块读取 userData 之前完成重定向
applyStoreDataIsolation();

app.commandLine.appendSwitch('wm-window-animations-disabled');

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

// 单实例锁：仅打包版生效，开发版允许多实例（安装版+开发版+worktree 可并存）
if (app.isPackaged) {
  const gotTheLock = app.requestSingleInstanceLock();
  if (!gotTheLock) {
    console.log('[App] Another instance is already running, exiting');
    app.exit(0);
  } else {
    app.on('second-instance', () => {
      console.log('[App] Second instance detected, focusing existing window');
      const popup = getPopupWindow();
      if (popup && !popup.isDestroyed() && popup.isVisible()) {
        popup.focus();
      } else {
        onTrayClick();
      }
    });
  }
}

// 全局模块实例
let trayManager: TrayManager | null = null;
let configManager: ConfigManager | null = null;
let scheduler: Scheduler | null = null;
// 最近一次加载的 Provider 列表快照，用于配置重载时 diff 出需增量刷新的账户
let loadedProviders: LoadedProvider[] = [];

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
  setMimoAuthDeps({ getConfigManager, getPopupWindow: getPopupWindow });
  setQoderAuthDeps({ getConfigManager, getPopupWindow: getPopupWindow });
  setStepfunAuthDeps({ getConfigManager, getPopupWindow: getPopupWindow });
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
    onResetPopupPosition: () => {
      resetPopupPosition();
    },
    onResetPopupSize: () => {
      resetPopupSize();
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
  loadedProviders = providers;
  console.log(`[App] Loaded ${providers.length} provider(s)`);

  // 8. 启动定时刷新
  trayManager.startLoading();

  let isAutoRefreshingToken = false;

  scheduler.on('refreshed', async () => {
    trayManager?.stopLoading();

    // 自动刷新 DeepSeek token；同步 MiMo/Qoder 登录状态
    if (!isAutoRefreshingToken) {
      const aggregated = scheduler!.getAggregatedData();
      if (aggregated) {
        const expiredAccounts: Array<{ provider: string; accountId: string }> = [];
        const mimoSuccessAccounts: string[] = [];
        const qoderExpiredAccounts: string[] = [];
        const qoderSuccessAccounts: string[] = [];
        for (const [key, result] of aggregated.results) {
          const [provider, accountId] = key.split(':');
          if (result.error === 'TOKEN_EXPIRED') {
            if (provider === 'deepseek' || provider === 'mimo') {
              expiredAccounts.push({ provider, accountId });
            }
            if (provider === 'qoder') {
              qoderExpiredAccounts.push(accountId);
            }
          } else if (provider === 'mimo' && !result.error) {
            // MiMo 成功获取数据，记录需要同步登录状态的账户
            mimoSuccessAccounts.push(accountId);
          } else if (provider === 'qoder' && !result.error) {
            // Qoder 成功获取数据，记录需要同步登录状态的账户
            qoderSuccessAccounts.push(accountId);
          }
        }

        // MiMo 成功获取数据时同步 mimoLoggedIn 状态
        if (mimoSuccessAccounts.length > 0) {
          const cfg = configManager?.getConfig();
          if (cfg) {
            const providers = structuredClone(cfg.providers);
            const mimo = providers.mimo as import('../shared/types').ProviderTypeConfig;
            if (mimo?.accounts) {
              let needSave = false;
              for (const accountId of mimoSuccessAccounts) {
                const account = mimo.accounts.find(a => a.id === accountId);
                if (account && !account.mimoLoggedIn) {
                  account.mimoLoggedIn = true;
                  needSave = true;
                }
              }
              if (needSave) {
                await configManager!.updateConfig({ providers });
              }
            }
          }
        }

        // Qoder 登录状态同步：成功置真；TOKEN_EXPIRED（Provider 内已重试一次）置假
        if (qoderSuccessAccounts.length > 0 || qoderExpiredAccounts.length > 0) {
          const cfg = configManager?.getConfig();
          if (cfg) {
            const providers = structuredClone(cfg.providers);
            const qoder = providers.qoder as import('../shared/types').ProviderTypeConfig;
            if (qoder?.accounts) {
              let needSave = false;
              for (const accountId of qoderSuccessAccounts) {
                const account = qoder.accounts.find(a => a.id === accountId);
                if (account && !account.qoderLoggedIn) {
                  account.qoderLoggedIn = true;
                  needSave = true;
                }
              }
              for (const accountId of qoderExpiredAccounts) {
                const account = qoder.accounts.find(a => a.id === accountId);
                if (account && account.qoderCookieSource !== 'manual' && account.qoderLoggedIn) {
                  account.qoderLoggedIn = false;
                  needSave = true;
                }
              }
              if (needSave) {
                await configManager!.updateConfig({ providers });
              }
            }
          }
        }

        if (expiredAccounts.length > 0) {
          isAutoRefreshingToken = true;
          let anyRefreshed = false;
          try {
            for (const { provider, accountId } of expiredAccounts) {
              if (provider === 'deepseek') {
                const ok = await deepseekRefreshToken(accountId);
                if (ok) anyRefreshed = true;
              } else if (provider === 'mimo') {
                // Provider 内部已尝试刷新页面重试，仍 TOKEN_EXPIRED 说明 session 真过期
                const cfg = configManager?.getConfig();
                if (cfg) {
                  const providers = structuredClone(cfg.providers);
                  const mimo = providers.mimo as import('../shared/types').ProviderTypeConfig;
                  const account = mimo?.accounts?.find(a => a.id === accountId);
                  if (account) {
                    account.mimoLoggedIn = false;
                    await configManager!.updateConfig({ providers });
                  }
                }
              }
            }
          } finally {
            isAutoRefreshingToken = false;
          }
          if (anyRefreshed) return;
        }
      }
    }

    // 推送数据到渲染进程
    pushUsageSnapshot();
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
  // 配置变更触发的重载+刷新防抖：连续开关多个 Provider 会产生密集 changed 事件，
  // 逐次立即刷新会对会话型站点形成请求风暴（曾触发 StepFun 服务端风控返回
  // auth 形状错误，被误判为会话过期），合并为静默 2s 后的一次重载+增量刷新
  let configRefreshTimer: ReturnType<typeof setTimeout> | null = null;

  configManager.on('changed', async (newConfig, oldConfig) => {
    console.log('[App] Configuration changed, updating...');

    // 更新语言
    if (newConfig.language && newConfig.language !== oldConfig?.language) {
      setLocale(newConfig.language);
      trayManager?.rebuildMenu();
    }

    // providers 变化时 UI 立即按新配置渲染（零网络）：新开账户显示加载中、
    // 关闭账户立即消失；数据仍由下方防抖后的增量链路异步补齐
    const providersChanged =
      JSON.stringify(newConfig.providers) !== JSON.stringify(oldConfig?.providers);
    if (providersChanged) {
      pushUsageSnapshot();
    }

    // 仅在影响数据获取的配置变化时才刷新
    const needsRefresh =
      providersChanged ||
      newConfig.refreshInterval !== oldConfig?.refreshInterval ||
      JSON.stringify(newConfig.display.colorThresholds) !== JSON.stringify(oldConfig?.display?.colorThresholds);

    // 更新图标显示规则
    if (newConfig.trayDisplayRule !== oldConfig?.trayDisplayRule) {
      scheduler!.setDisplayRule(newConfig.trayDisplayRule ?? 'lowest');
    }

    if (needsRefresh) {
      if (configRefreshTimer) clearTimeout(configRefreshTimer);
      configRefreshTimer = setTimeout(() => {
        configRefreshTimer = null;
        const providers = ProviderLoader.loadProviders(newConfig.providers);
        // 仅新增/配置变化的账户发起独立请求，正常运行的 Provider 不再全量重刷
        const incrementalKeys = diffChangedProviderKeys(loadedProviders, providers);
        scheduler!.setProviders(providers);
        loadedProviders = providers;
        scheduler!.setColorThresholds(newConfig.display.colorThresholds);
        console.log(`[App] Reloaded ${providers.length} provider(s)`);

        // 增量排水：请求新增/变化账户（空列表时仅裁剪快照并推送，不发起请求）。
        // 必须先于 setRefreshInterval：间隔变化重启定时器触发的全量刷新会避让 pending 成员
        scheduler!.queueIncremental(incrementalKeys);

        scheduler!.setRefreshInterval(newConfig.refreshInterval * 1000);
      }, 2000);
    }

    // 更新开机自启
    updateAutoStart(newConfig.autoStart);

    // 内存节省模式变化
    if (newConfig.memorySavingMode !== oldConfig?.memorySavingMode) {
      if (newConfig.memorySavingMode && !isPopupVisibleNow()) {
        destroyPopupWindow();
        console.log('[App] Memory saving mode enabled, destroyed hidden window');
      } else if (!newConfig.memorySavingMode && !getPopupWindow()) {
        createPopupWindow(undefined, '设置变更');
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
 * 构建并推送 UI 快照到弹窗（纯本地，不触发任何网络请求）
 */
function pushUsageSnapshot(): void {
  const popup = getPopupWindow();
  if (!popup || popup.isDestroyed()) return;
  const data = buildUsageData();
  if (data) {
    popup.webContents.send('usage-data-updated', data);
  }
}

/**
 * 对比重载前后的 Provider 列表，返回新增或配置发生变化的账户复合键（type:accountId）
 * 配置变化包括 API Key、认证模式、站点等任何影响请求的字段
 */
function diffChangedProviderKeys(previous: LoadedProvider[], next: LoadedProvider[]): string[] {
  const compoundKey = (p: LoadedProvider): string => `${p.type}:${p.accountId}`;
  const previousConfigs = new Map<string, string>(
    previous.map(p => [compoundKey(p), JSON.stringify(p.config)]),
  );
  const changed: string[] = [];
  for (const p of next) {
    const key = compoundKey(p);
    if (previousConfigs.get(key) !== JSON.stringify(p.config)) {
      changed.push(key);
    }
  }
  return changed;
}

/**
 * 设置开机自启
 */
function updateAutoStart(enabled: boolean): void {
  if (!app.isPackaged) {
    console.log('[App] Auto-start skipped: running in development mode');
    return;
  }
  // MSIX 商店版下注册表 Run 键写入会被包容器虚拟化而失效，商店版不提供开机自启
  if (isStoreBuild()) {
    console.log('[App] Auto-start skipped: store build');
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
    // 初始化失败（如配置不可读且无法备份）时直接退出，避免残留后台空进程
    app.quit();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createPopupWindow(undefined, '应用激活');
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
