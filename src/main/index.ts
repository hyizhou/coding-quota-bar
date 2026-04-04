import { app, BrowserWindow, ipcMain } from 'electron';
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

/**
 * 创建悬浮详情面板
 */
function createPopupWindow(): void {
  if (popupWindow) {
    return;
  }

  popupWindow = new BrowserWindow({
    width: 320,
    height: 400,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
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

  // 失焦时自动关闭
  popupWindow.on('blur', () => {
    const win = popupWindow;
    if (win && !win.isDestroyed() && !win.isFocused()) {
      win.close();
    }
  });

  popupWindow.on('closed', () => {
    popupWindow = null;
  });
}

/**
 * 切换面板显示状态
 */
function togglePopupWindow(): void {
  if (popupWindow && popupWindow.isVisible()) {
    popupWindow.hide();
  } else {
    if (!popupWindow) {
      createPopupWindow();
    }
    // TODO: 计算托盘图标位置，将面板定位到图标附近
    popupWindow?.show();
  }
}

/**
 * 打开设置：弹出 popup 窗口并切换到设置视图
 */
function openSettings(): void {
  if (!popupWindow) {
    createPopupWindow();
  }
  popupWindow?.show();
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
  trayManager.onClick(() => {
    togglePopupWindow();
  });

  // 3. 创建调度器
  scheduler = createScheduler(config);
  scheduler.setTrayManager(trayManager);

  // 4. 加载 Provider
  const providers = ProviderLoader.loadProviders(config.providers);
  scheduler.setProviders(providers);

  console.log(`[App] Loaded ${providers.length} provider(s)`);

  // 5. 启动定时刷新
  scheduler.start();

  // 6. 设置开机自启
  updateAutoStart(config.autoStart);

  // 7. 监听配置变化
  setupConfigListeners();

  // 8. 设置 IPC 通信
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
