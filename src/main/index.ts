import { app, BrowserWindow, ipcMain, screen } from 'electron';
import * as fs from 'node:fs';
import * as path from 'path';
import { TrayManager, getColorByPercent } from './tray';
import { ProviderLoader } from './loader';
import { Scheduler, createScheduler } from './scheduler';
import { ConfigManager } from './config';
import { setLocale, t as i18nT } from './i18n';
import type { UsageResult } from '../shared/types';

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

/**
 * Provider 显示数据
 */
interface ProviderDisplayData {
  name: string;
  used: number;
  total: number;
  percent: number;
  expiresAt: string;
  color: 'green' | 'yellow' | 'red';
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
 * 将窗口移到屏幕外实现"隐藏"，避免 hide/show 导致 DWM 重新合成透明窗口闪烁
 */
function hidePopupWindow(): void {
  if (!popupWindow || popupWindow.isDestroyed()) return;
  popupWindow.setBounds({ x: -9999, y: -9999, width: POPUP_WIDTH, height: POPUP_HEIGHT });
  isPopupVisible = false;
}

/**
 * 显示弹出窗口（悬浮触发）
 */
function showPopupWindow(): void {
  cancelHide();
  isHoveringWindow = false;
  if (!isPopupVisible) {
    isPinned = false;
  }
  if (!popupWindow) {
    createPopupWindow();
  }
  if (popupWindow && !popupWindow.isDestroyed()) {
    const { x, y } = getPopupPosition();
    popupWindow.setBounds({ x, y, width: POPUP_WIDTH, height: POPUP_HEIGHT });
    isPopupVisible = true;
  }
}

/**
 * 延迟隐藏弹出窗口（给鼠标从 tray 移到窗口留时间）
 */
function scheduleHide(): void {
  if (isPinned) return;
  cancelHide();
  hideTimer = setTimeout(() => {
    hideTimer = null;
    if (!isPinned && !isHoveringWindow && popupWindow && !popupWindow.isDestroyed() && isPopupVisible) {
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
 * 打开设置：弹出 popup 窗口并切换到设置视图
 */
function openSettings(): void {
  if (!popupWindow) {
    createPopupWindow();
  }
  if (popupWindow && !popupWindow.isDestroyed()) {
    const { x, y } = getPopupPosition();
    popupWindow.setBounds({ x, y, width: POPUP_WIDTH, height: POPUP_HEIGHT });
    isPopupVisible = true;
    popupWindow.webContents.send('show-settings');
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
    onQuit: () => {
      // 退出应用
      app.quit();
    }
  });
  trayManager.onMouseEnter(() => {
    showPopupWindow();
  });
  trayManager.onMouseLeave(() => {
    scheduleHide();
  });
  trayManager.onClick(() => {
    if (isPinned) {
      // 已 pin 状态，点击取消 pin 并隐藏
      isPinned = false;
      hidePopupWindow();
    } else if (isPopupVisible) {
      // 窗口可见但未 pin，切换为 pin
      isPinned = true;
    } else {
      // 窗口不可见，显示并 pin
      showPopupWindow();
      isPinned = true;
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

    // 重新加载 Provider
    const providers = ProviderLoader.loadProviders(newConfig.providers);
    scheduler!.setProviders(providers);

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

  // 更新配置
  ipcMain.handle('update-config', async (_, updates) => {
    if (!configManager) return null;
    await configManager.updateConfig(updates);
    return configManager.getConfig();
  });
}

/**
 * 构建返回给 renderer 的用量数据
 */
function buildUsageData(): UsageDataForRenderer | null {
  if (!scheduler) return null;

  const aggregated = scheduler.getAggregatedData();
  const thresholds = scheduler.getThresholds();

  if (!aggregated) return null;

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
  const percent = result.total > 0 ? ((result.total - result.used) / result.total) * 100 : 0;

  return {
    name: getProviderDisplayName(type),
    used: result.used,
    total: result.total,
    percent: Math.round(percent * 10) / 10,
    expiresAt: result.expiresAt,
    color: getColorByPercent(percent, thresholds)
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
