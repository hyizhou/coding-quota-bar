import { app, BrowserWindow, ipcMain, screen } from 'electron';
import * as fs from 'node:fs';
import * as path from 'path';
import { TrayManager, getColorByPercent } from './tray';
import { ProviderLoader } from './loader';
import { Scheduler, createScheduler } from './scheduler';
import { ConfigManager } from './config';
import { setLocale, t as i18nT } from './i18n';
import type { UsageResult, QuotaItem as SharedQuotaItem, UsageRecord as SharedUsageRecord } from '../shared/types';

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

// 全局模块实例
let trayManager: TrayManager | null = null;
let popupWindow: BrowserWindow | null = null;
let configManager: ConfigManager | null = null;
let scheduler: Scheduler | null = null;
let hideTimer: ReturnType<typeof setTimeout> | null = null;
let isHoveringWindow = false;
let isPopupVisible = false;
let isPinned = false;
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
  used: number;
  total: number;
  usageRate: number;
  resetAt: string;
  color: 'green' | 'yellow' | 'red';
}

/**
 * Provider 显示数据
 */
interface ProviderDisplayData {
  name: string;
  level?: string;
  error?: string;
  quotas: QuotaDisplayItem[];
  usageHistory: SharedUsageRecord[];
}

/**
 * Renderer 进程期望的数据格式
 */
interface UsageDataForRenderer {
  providers: ProviderDisplayData[];
  lastUpdate: string;
  overallPercent: number;
}

const POPUP_WIDTH = 320;
const POPUP_HEIGHT = 400;

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
function openSettings(): void {
  showPopupWindow(PopupMode.Pinned);
  popupWindow?.webContents.send('show-settings');
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
  scheduler.on('refreshed', () => {
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

  configManager.on('changed', async (newConfig) => {
    console.log('[App] Configuration changed, updating...');

    // 更新语言
    if (newConfig.language) {
      setLocale(newConfig.language);
      trayManager?.rebuildMenu();
    }

    // 更新刷新间隔
    scheduler!.setRefreshInterval(newConfig.refreshInterval * 1000);

    // 更新颜色阈值
    scheduler!.setColorThresholds(newConfig.display.colorThresholds);

    // 重新加载 Provider 并刷新
    const providers = ProviderLoader.loadProviders(newConfig.providers);
    scheduler!.setProviders(providers);
    scheduler!.refresh().catch((error) => {
      console.error('[App] Refresh after config change failed:', error);
    });

    console.log(`[App] Reloaded ${providers.length} provider(s)`);

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
    openAsHidden: true,
    path: process.execPath
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

  // 获取开发状态
  ipcMain.handle('get-dev-mode', () => {
    return isDev;
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

  // 从环境变量导入 API Key
  ipcMain.handle('import-key-from-env', async (_, providerKey: string) => {
    const envVarMap: Record<string, string> = {
      zhipu: 'Z_AI_API_KEY',
      minimax: 'MINIMAX_API_KEY',
      kimi: 'KIMI_API_KEY'
    };
    const envVar = envVarMap[providerKey];
    if (!envVar) {
      return { success: false, error: `Unknown provider: ${providerKey}` };
    }
    const value = process.env[envVar]?.trim();
    if (!value) {
      return { success: false, error: `Environment variable ${envVar} not found` };
    }
    if (!configManager) {
      return { success: false, error: 'Config not initialized' };
    }
    await configManager.updateConfig({
      providers: { [providerKey]: { apiKey: value } }
    });
    return { success: true };
  });

  // 更新配置
  ipcMain.handle('update-config', async (_, updates) => {
    if (!configManager) return null;
    await configManager.updateConfig(updates);
    return configManager.getConfig();
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
    used: q.used,
    total: q.total,
    usageRate: q.usageRate,
    resetAt: q.resetAt,
    color: getColorByPercent(100 - q.usageRate, thresholds)
  }));

  const usageHistory: SharedUsageRecord[] = (result.details?.usageHistory ?? []).map(r => ({
    date: r.date,
    used: r.used
  }));

  return {
    name: getProviderDisplayName(type),
    level: result.level,
    error: result.error,
    quotas,
    usageHistory
  };
}

/**
 * 获取 Provider 显示名称
 */
function getProviderDisplayName(type: string): string {
  const names: Record<string, string> = {
    'zhipu': i18nT('providers.zhipu'),
    'minimax': 'MiniMax',
    'kimi': 'Kimi'
  };
  return names[type] || type;
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
