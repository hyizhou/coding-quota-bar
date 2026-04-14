import { app, BrowserWindow, ipcMain, screen, shell } from 'electron';
import * as fs from 'node:fs';
import * as path from 'path';
import { TrayManager, getColorByPercent } from './tray';
import { ProviderLoader, getAvailableProviderKeys } from './loader';
import { Scheduler, createScheduler } from './scheduler';
import { ConfigManager } from './config';
import { setLocale, t as i18nT } from './i18n';
import { autoUpdater } from 'electron-updater';
import type { UsageResult, UsageRecord as SharedUsageRecord, McpUsageRecord as SharedMcpUsageRecord, ModelTokenRecord as SharedModelTokenRecord } from '../shared/types';

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

// 是否处于开发状态（DEV=1 时生效，来源可以是 .env 文件或系统环境变量）
const isDev = process.env.DEV === '1';
console.log('[App] DEV mode:', isDev);

// 自动更新配置
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;
if (isDev) {
  autoUpdater.forceDevUpdateConfig = false;
}

autoUpdater.on('download-progress', (progress) => {
  console.log(`[Updater] Downloading: ${progress.percent.toFixed(1)}%`);
  if (popupWindow && !popupWindow.isDestroyed()) {
    popupWindow.webContents.send('update-download-progress', {
      percent: Math.round(progress.percent),
      transferred: progress.transferred,
      total: progress.total
    });
  }
});

autoUpdater.on('update-downloaded', () => {
  console.log('[Updater] Update downloaded');
  // 持久化下载完成状态
  const config = configManager?.getConfig();
  if (config?.updateInfo) {
    configManager?.updateConfig({
      updateInfo: { ...config.updateInfo, downloaded: true }
    }).catch((error) => {
      console.error('[Updater] Failed to save update info:', error);
    });
  }
  if (popupWindow && !popupWindow.isDestroyed()) {
    popupWindow.webContents.send('update-downloaded');
  }
});

autoUpdater.on('update-not-available', () => {
  console.log('[Updater] No update available');
});

autoUpdater.on('error', (error) => {
  console.error('[Updater] Error:', error.message);
});

// 全局模块实例
let trayManager: TrayManager | null = null;
let popupWindow: BrowserWindow | null = null;
let configManager: ConfigManager | null = null;
let scheduler: Scheduler | null = null;
let hideTimer: ReturnType<typeof setTimeout> | null = null;
let isHoveringWindow = false;
let isPopupVisible = false;
let blurHandler: (() => void) | null = null;

/**
 * 窗口显示模式
 */
const enum PopupMode {
  Hover = 'hover',   // 悬浮触发，鼠标离开自动隐藏
  Pinned = 'pinned', // 点击触发，点击外部隐藏
  Hidden = 'hidden'  // 窗口在屏幕外
}

let popupMode: PopupMode = PopupMode.Hidden;

/**
 * Renderer 端额度项
 */
interface QuotaDisplayItem {
  label: string;
  labelParams?: Record<string, string | number>;
  used: number;
  total: number;
  usageRate: number;
  resetAt: string;
  color: 'green' | 'yellow' | 'red';
  limitType?: string;
}

/**
 * Provider 显示数据
 */
interface ProviderDisplayData {
  name: string;
  level?: string;
  error?: string;
  quotas: QuotaDisplayItem[];
  history1d: SharedUsageRecord[];
  history7d: SharedUsageRecord[];
  history30d: SharedUsageRecord[];
  totalTokens1d: number;
  totalTokens7d: number;
  totalTokens30d: number;
  mcpHistory1d: SharedMcpUsageRecord[];
  mcpHistory7d: SharedMcpUsageRecord[];
  mcpHistory30d: SharedMcpUsageRecord[];
  modelHistory1d: SharedModelTokenRecord[];
  modelHistory7d: SharedModelTokenRecord[];
  modelHistory30d: SharedModelTokenRecord[];
}

/**
 * Renderer 进程期望的数据格式
 */
interface UsageDataForRenderer {
  providers: ProviderDisplayData[];
  lastUpdate: string;
  overallPercent: number;
}

const POPUP_WIDTH = 336;
const POPUP_HEIGHT = 416;

/**
 * 计算弹出窗口位置：在托盘图标上方居中显示
 */
function getPopupPosition(): { x: number; y: number } {
  const trayBounds = trayManager?.getBounds();
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;

  let x: number;
  let y: number;

  if (trayBounds) {
    // 水平居中于托盘图标
    x = Math.round(trayBounds.x + trayBounds.width / 2 - POPUP_WIDTH / 2);
    // 在托盘图标上方显示
    y = Math.round(trayBounds.y - POPUP_HEIGHT);
  } else {
    // 回退：屏幕右下角
    x = screenWidth - POPUP_WIDTH;
    y = screenHeight - POPUP_HEIGHT;
  }

  // 确保不超出屏幕边界
  x = Math.max(0, Math.min(x, screenWidth - POPUP_WIDTH));
  y = Math.max(0, Math.min(y, screenHeight - POPUP_HEIGHT));

  return { x, y };
}

/**
 * 创建悬浮详情面板（启动时调用一次，之后复用 show/hide）
 */
function createPopupWindow(): void {
  if (popupWindow) {
    return;
  }

  popupWindow = new BrowserWindow({
    x: -9999,
    y: -9999,
    width: POPUP_WIDTH,
    height: POPUP_HEIGHT,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  // 加载面板页面
  if (process.env.ELECTRON_RENDERER_URL) {
    popupWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    popupWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  popupWindow.on('closed', () => {
    popupWindow = null;
  });
}

/**
 * 绑定 blur 监听器（Pinned 模式专用）
 */
function attachBlurHandler(): void {
  detachBlurHandler();
  blurHandler = () => {
    if (popupMode === PopupMode.Pinned) {
      hidePopupWindow();
    }
  };
  popupWindow?.on('blur', blurHandler);
}

/**
 * 解绑 blur 监听器
 */
function detachBlurHandler(): void {
  if (blurHandler && popupWindow) {
    popupWindow.off('blur', blurHandler);
    blurHandler = null;
  }
}

/**
 * 将窗口移到屏幕外实现"隐藏"
 */
function hidePopupWindow(): void {
  if (!popupWindow || popupWindow.isDestroyed()) return;
  detachBlurHandler();
  popupWindow.setBounds({ x: -9999, y: -9999, width: POPUP_WIDTH, height: POPUP_HEIGHT });
  isPopupVisible = false;
  popupMode = PopupMode.Hidden;
}

/**
 * 显示弹出窗口
 */
function showPopupWindow(mode: PopupMode.Hover | PopupMode.Pinned): void {
  cancelHide();
  isHoveringWindow = false;

  if (!popupWindow) {
    createPopupWindow();
  }
  if (popupWindow && !popupWindow.isDestroyed()) {
    const { x, y } = getPopupPosition();
    popupWindow.setBounds({ x, y, width: POPUP_WIDTH, height: POPUP_HEIGHT });
    isPopupVisible = true;
    popupMode = mode;

    if (mode === PopupMode.Pinned) {
      attachBlurHandler();
    } else {
      detachBlurHandler();
    }
  }
}

/**
 * 检测鼠标是否在弹出窗口范围内
 */
function isCursorInPopupBounds(): boolean {
  if (!popupWindow || popupWindow.isDestroyed()) return false;
  const bounds = popupWindow.getBounds();
  const cursor = screen.getCursorScreenPoint();
  return (
    cursor.x >= bounds.x && cursor.x <= bounds.x + bounds.width &&
    cursor.y >= bounds.y && cursor.y <= bounds.y + bounds.height
  );
}

/**
 * 延迟隐藏弹出窗口（Hover 模式专用，给鼠标从 tray 移到窗口留时间）
 */
function scheduleHide(): void {
  if (popupMode !== PopupMode.Hover) return;
  cancelHide();
  hideTimer = setTimeout(() => {
    hideTimer = null;
    if (popupMode !== PopupMode.Hover) return;
    if (!popupWindow || popupWindow.isDestroyed() || !isPopupVisible) return;
    // 用屏幕坐标直接判断鼠标是否在窗口范围内（不依赖 renderer 的 DOM 事件）
    const inBounds = isCursorInPopupBounds();
    console.log('[Popup] scheduleHide callback: cursorInBounds =', inBounds, 'mode =', popupMode);
    if (!inBounds) {
      hidePopupWindow();
    }
  }, 300);
}

function cancelHide(): void {
  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
}

/**
 * 打开设置：弹出 popup 窗口并切换到设置视图（Pinned 模式）
 */
function openSettings(options?: { checkUpdate?: boolean }): void {
  if (options?.checkUpdate) {
    // 先发事件让渲染进程准备，不立即显示弹窗
    popupWindow?.webContents.send('show-settings', options);
  } else {
    showPopupWindow(PopupMode.Pinned);
    popupWindow?.webContents.send('show-settings');
  }
}

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

  // 2. 创建托盘管理器
  trayManager = new TrayManager();
  trayManager.setCallbacks({
    onRefresh: () => {
      // 手动刷新用量
      scheduler?.refresh().catch((error) => {
        console.error('[App] Manual refresh failed:', error);
      });
    },
    onSettings: () => {
      openSettings();
    },
    onAutoStartToggle: (enabled) => {
      // 切换开机自启
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
      // 退出应用
      app.quit();
    }
  });
  trayManager.onMouseEnter(() => {
    if (popupMode === PopupMode.Hidden) {
      showPopupWindow(PopupMode.Hover);
    }
  });
  trayManager.onMouseLeave(() => {
    scheduleHide();
  });
  trayManager.onClick(() => {
    if (popupMode === PopupMode.Pinned) {
      // Pinned 模式：点击隐藏
      hidePopupWindow();
    } else if (popupMode === PopupMode.Hover) {
      // Hover 模式：切换为 Pinned
      showPopupWindow(PopupMode.Pinned);
    } else {
      // Hidden 模式：显示并 Pinned
      showPopupWindow(PopupMode.Pinned);
    }
  });

  // 3. 预创建并加载弹出窗口（隐藏状态，后续直接 show/hide 复用）
  createPopupWindow();

  // 4. 创建调度器
  scheduler = createScheduler(config);
  scheduler.setTrayManager(trayManager);

  // 5. 加载 Provider
  const providers = ProviderLoader.loadProviders(config.providers);
  scheduler.setProviders(providers);

  console.log(`[App] Loaded ${providers.length} provider(s)`);

  // 6. 启动定时刷新
  trayManager.startLoading();

  scheduler.on('refreshed', () => {
    // 首次获取到数据后停止加载动画
    trayManager?.stopLoading();
    // 刷新完成后主动推送数据到渲染进程
    const data = buildUsageData();
    if (popupWindow && !popupWindow.isDestroyed()) {
      popupWindow.webContents.send('usage-data-updated', data);
    }
  });
  scheduler.start();

  // 7. 设置开机自启
  updateAutoStart(config.autoStart);

  // 8. 监听配置变化
  setupConfigListeners();

  // 9. 设置 IPC 通信
  setupIpcHandlers();

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

    if (needsRefresh) {
      // 更新刷新间隔（间隔变化时会重启定时器并自动刷新）
      const intervalChanged = scheduler!.setRefreshInterval(newConfig.refreshInterval * 1000);

      // 更新颜色阈值
      scheduler!.setColorThresholds(newConfig.display.colorThresholds);

      // 重新加载 Provider
      const providers = ProviderLoader.loadProviders(newConfig.providers);
      scheduler!.setProviders(providers);

      console.log(`[App] Reloaded ${providers.length} provider(s)`);

      // 仅当间隔未变化时才需要手动刷新（间隔变化已通过重启触发刷新）
      if (!intervalChanged) {
        scheduler!.refresh().catch((error) => {
          console.error('[App] Refresh after config change failed:', error);
        });
      }
    }

    // 更新开机自启
    updateAutoStart(newConfig.autoStart);
  });
}

/**
 * 设置开机自启
 */
function updateAutoStart(enabled: boolean): void {
  app.setLoginItemSettings({
    openAtLogin: enabled,
    openAsHidden: true
  });
  console.log(`[App] Auto-start: ${enabled ? 'enabled' : 'disabled'}`);

  // 同步托盘菜单的勾选状态
  trayManager?.setAutoStart(enabled);
}

/**
 * 设置 IPC 通信处理器
 */
function setupIpcHandlers(): void {
  // 监听 renderer 的鼠标悬浮状态
  ipcMain.on('popup-hover-state', (_, hovering: boolean) => {
    isHoveringWindow = hovering;
    if (popupMode !== PopupMode.Hover) return;
    if (hovering) {
      cancelHide();
    } else {
      scheduleHide();
    }
  });

  // 渲染进程准备好后显示弹窗
  ipcMain.on('show-popup', () => {
    showPopupWindow(PopupMode.Pinned);
  });

  // 获取当前用量数据
  ipcMain.handle('get-usage-data', () => {
    return buildUsageData();
  });

  // 手动刷新
  ipcMain.handle('refresh-usage', async () => {
    if (!scheduler) return null;
    await scheduler.refresh();
    return buildUsageData();
  });

  // 获取配置
  ipcMain.handle('get-config', () => {
    return configManager?.getConfig();
  });

  // 获取可用的 provider 列表（编译时配置）
  ipcMain.handle('get-available-providers', () => {
    return getAvailableProviderKeys();
  });

  // 更新配置
  ipcMain.handle('update-config', async (_, updates) => {
    if (!configManager) return null;
    await configManager.updateConfig(updates);
    return configManager.getConfig();
  });

  // 获取应用版本号
  ipcMain.handle('get-app-version', () => {
    return app.getVersion();
  });

  // 检查更新（仅检查，不下载）
  ipcMain.handle('check-for-update', async () => {
    if (isDev) {
      return { available: false };
    }
    try {
      const result = await autoUpdater.checkForUpdates();
      if (result?.updateInfo) {
        const latestVersion = result.updateInfo.version;
        const currentVersion = app.getVersion();
        const available = latestVersion > currentVersion;
        // 持久化更新检查结果
        if (available) {
          await configManager?.updateConfig({
            updateInfo: { version: latestVersion, downloaded: false }
          });
        } else {
          await configManager?.updateConfig({ updateInfo: undefined });
        }
        return { available, version: latestVersion };
      }
      return { available: false };
    } catch {
      return { available: false, error: true };
    }
  });

  // 下载更新
  ipcMain.handle('download-update', async () => {
    try {
      await autoUpdater.downloadUpdate();
      return true;
    } catch {
      return false;
    }
  });

  // 重启并安装更新
  ipcMain.handle('quit-and-install', () => {
    autoUpdater.quitAndInstall();
  });

  // 用系统浏览器打开链接
  ipcMain.handle('open-external', async (_, url: string) => {
    await shell.openExternal(url);
  });
}

/**
 * 检查当前配置是否有启用的 Provider
 */
function hasEnabledProviders(): boolean {
  const config = configManager?.getConfig();
  if (!config) return false;
  return Object.values(config.providers).some(p => p.enabled);
}

/**
 * 构建返回给 renderer 的用量数据
 */
function buildUsageData(): UsageDataForRenderer | null {
  if (!scheduler) return null;

  // 以配置为准：没有启用的 Provider 时直接返回空数据
  if (!hasEnabledProviders()) {
    return {
      providers: [],
      lastUpdate: new Date().toISOString(),
      overallPercent: 100
    };
  }

  const aggregated = scheduler.getAggregatedData();
  const thresholds = scheduler.getThresholds();

  if (!aggregated) {
    return {
      providers: [],
      lastUpdate: new Date().toISOString(),
      overallPercent: 100
    };
  }

  // 转换为 renderer 期望的格式
  const providers = Array.from(aggregated.results.entries()).map(([type, result]) => {
    return convertProviderData(type, result, thresholds);
  });

  return {
    providers,
    lastUpdate: aggregated.lastUpdate.toISOString(),
    overallPercent: aggregated.lowestPercent
  };
}

/**
 * 转换单个 Provider 数据为显示格式
 */
function convertProviderData(
  type: string,
  result: UsageResult,
  thresholds: { green: number; yellow: number }
): ProviderDisplayData {
  const quotas: QuotaDisplayItem[] = (result.details?.quotas ?? []).map(q => ({
    label: q.label,
    labelParams: (q as any).labelParams,
    used: q.used,
    total: q.total,
    usageRate: q.usageRate,
    resetAt: q.resetAt,
    color: getColorByPercent(100 - q.usageRate, thresholds),
    limitType: q.limitType
  }));

  const mapHistory = (key: string): SharedUsageRecord[] =>
    ((result.details?.[key] ?? []) as SharedUsageRecord[]).map(r => ({ date: r.date, used: r.used }));

  const mapMcpHistory = (key: string): SharedMcpUsageRecord[] =>
    ((result.details?.[key] ?? []) as SharedMcpUsageRecord[]).map(r => ({ date: r.date, search: r.search, webRead: r.webRead, zread: r.zread }));

  const mapModelHistory = (key: string): SharedModelTokenRecord[] =>
    ((result.details?.[key] ?? []) as SharedModelTokenRecord[]).map(r => ({ date: r.date, model: r.model, used: r.used }));

  console.log(`[Data] ${type} 1d:${mapHistory('history1d').length} 7d:${mapHistory('history7d').length} 30d:${mapHistory('history30d').length}`);

  return {
    name: getProviderDisplayName(type),
    level: result.level,
    error: result.error,
    quotas,
    history1d: mapHistory('history1d'),
    history7d: mapHistory('history7d'),
    history30d: mapHistory('history30d'),
    totalTokens1d: (result.details?.totalTokens1d as number) ?? 0,
    totalTokens7d: (result.details?.totalTokens7d as number) ?? 0,
    totalTokens30d: (result.details?.totalTokens30d as number) ?? 0,
    mcpHistory1d: mapMcpHistory('mcpHistory1d'),
    mcpHistory7d: mapMcpHistory('mcpHistory7d'),
    mcpHistory30d: mapMcpHistory('mcpHistory30d'),
    modelHistory1d: mapModelHistory('modelHistory1d'),
    modelHistory7d: mapModelHistory('modelHistory7d'),
    modelHistory30d: mapModelHistory('modelHistory30d')
  };
}

/**
 * 获取 Provider 显示名称
 */
function getProviderDisplayName(type: string): string {
  return i18nT(`providers.${type}`) || type;
}

/**
 * Electron app 就绪
 */
app.whenReady().then(() => {
  initialize().catch((error) => {
    console.error('[App] Initialization failed:', error);
  });

  app.on('activate', () => {
    // macOS 特有行为：点击 dock 图标时重新创建窗口
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
    // app.quit();
  }
});

/**
 * 应用退出前清理
 */
app.on('before-quit', () => {
  console.log('[App] Cleaning up...');

  // 停止调度器
  scheduler?.destroy();

  // 销毁托盘
  trayManager?.destroy();

  // 销毁配置管理器
  configManager?.destroy();
});

console.log('Coding Quota Bar started');
