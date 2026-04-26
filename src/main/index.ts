import { app, BrowserWindow, ipcMain, screen, session, shell } from 'electron';
import * as fs from 'node:fs';
import * as path from 'path';
import { TrayManager, getColorByPercent } from './tray';
import { ProviderLoader, getAvailableProviderKeys } from './loader';
import { DeepSeekProvider } from '../providers/deepseek';
import buildConfig from '../../app.build';
import { Scheduler, createScheduler } from './scheduler';
import { ConfigManager } from './config';
import { setLocale, t as i18nT } from './i18n';
import { autoUpdater } from 'electron-updater';
import type { UsageResult, UsageRecord as SharedUsageRecord, McpUsageRecord as SharedMcpUsageRecord, ModelTokenRecord as SharedModelTokenRecord, PerformanceRecord as SharedPerformanceRecord, ProviderTypeConfig, UpdateInfo } from '../shared/types';

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

// 是否处于开发状态（CQB_DEV=1 时生效，来源可以是 .env 文件或系统环境变量）
const isDev = process.env.CQB_DEV === '1';
const mockUpdate = process.env.CQB_MOCK_UPDATE === '1';
console.log('[App] DEV mode:', isDev, '| Mock update:', mockUpdate);

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
  if (sessionUpdateInfo) {
    sessionUpdateInfo = { ...sessionUpdateInfo, downloaded: true };
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

/**
 * 自动更新检查调度器
 */
function startAutoUpdateChecker(): void {
  const config = configManager?.getConfig();
  if (!config?.autoCheckUpdate || (isDev && !mockUpdate)) return;

  const intervalMs = (config.autoCheckUpdateInterval || 14400) * 1000;
  const lastCheck = config.lastAutoCheckTime ? new Date(config.lastAutoCheckTime).getTime() : 0;
  const elapsed = Date.now() - lastCheck;
  const remaining = Math.max(0, intervalMs - elapsed);
  const initialDelay = lastCheck === 0 ? 30000 : remaining;

  console.log(`[AutoUpdate] Scheduling first check in ${Math.round(initialDelay / 1000)}s`);

  autoUpdateTimerId = setTimeout(async () => {
    autoUpdateTimerId = null;
    await performAutoCheck();
    scheduleNextAutoCheck();
  }, initialDelay);
}

async function performAutoCheck(): Promise<void> {
  if (isAutoChecking) {
    console.log('[AutoUpdate] Check already in progress, skipping');
    return;
  }

  const config = configManager?.getConfig();
  if (!config?.autoCheckUpdate) return;

  isAutoChecking = true;
  console.log('[AutoUpdate] Checking for updates...');

  try {
    // 模拟更新：构造一个比当前版本号更高的假版本
    if (mockUpdate) {
      const currentVersion = app.getVersion();
      const parts = currentVersion.split('.').map(Number);
      parts[2] = (parts[2] || 0) + 1;
      const mockVersion = parts.join('.');
      console.log(`[AutoUpdate] Mock update: v${mockVersion}`);
      sessionUpdateInfo = { version: mockVersion, downloaded: false };
      if (popupWindow && !popupWindow.isDestroyed()) {
        popupWindow.webContents.send('update-available-auto', { version: mockVersion });
      }
      return;
    }

    const result = await autoUpdater.checkForUpdates();
    await configManager?.updateConfig({
      lastAutoCheckTime: new Date().toISOString()
    });

    if (result?.updateInfo) {
      const latestVersion = result.updateInfo.version;
      const currentVersion = app.getVersion();

      if (latestVersion > currentVersion) {
        console.log(`[AutoUpdate] Update available: v${latestVersion}`);
        sessionUpdateInfo = { version: latestVersion, downloaded: false };
        if (popupWindow && !popupWindow.isDestroyed()) {
          popupWindow.webContents.send('update-available-auto', { version: latestVersion });
        }
      } else {
        console.log('[AutoUpdate] No update available');
        sessionUpdateInfo = null;
      }
    }
  } catch (error) {
    console.error('[AutoUpdate] Check failed:', error);
    await configManager?.updateConfig({
      lastAutoCheckTime: new Date().toISOString()
    });
  } finally {
    isAutoChecking = false;
  }
}

function scheduleNextAutoCheck(): void {
  const config = configManager?.getConfig();
  if (!config?.autoCheckUpdate) return;

  const intervalMs = (config.autoCheckUpdateInterval || 14400) * 1000;
  autoUpdateTimerId = setTimeout(async () => {
    autoUpdateTimerId = null;
    await performAutoCheck();
    scheduleNextAutoCheck();
  }, intervalMs);
}

function stopAutoUpdateChecker(): void {
  if (autoUpdateTimerId) {
    clearTimeout(autoUpdateTimerId);
    autoUpdateTimerId = null;
  }
}

// 全局模块实例
let trayManager: TrayManager | null = null;
let popupWindow: BrowserWindow | null = null;
let configManager: ConfigManager | null = null;
let scheduler: Scheduler | null = null;
let hideTimer: ReturnType<typeof setTimeout> | null = null;
let isHoveringWindow = false;
let isPopupVisible = false;
let blurHandler: (() => void) | null = null;

// 自动更新检查调度
let autoUpdateTimerId: ReturnType<typeof setTimeout> | null = null;
let isAutoChecking = false;
let sessionUpdateInfo: UpdateInfo | null = null;

// DeepSeek 网页登录窗口
const loginWindows = new Map<string, BrowserWindow>();

/**
 * 窗口显示模式
 */
const enum PopupMode {
  Hover = 'hover',   // 悬浮触发，鼠标离开自动隐藏
  Pinned = 'pinned', // 点击触发，点击外部隐藏
  Hidden = 'hidden'  // 窗口在屏幕外
}

let popupMode: PopupMode = PopupMode.Hidden;
let isLocked = false; // 窗口锁定：阻止 blur 隐藏

/**
 * 检查是否启用了内存节省模式
 */
function isMemorySavingMode(): boolean {
  return configManager?.getConfig()?.memorySavingMode === true;
}

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
  startAt?: string;
  color: 'green' | 'yellow' | 'red';
  limitType?: string;
}

/**
 * 单个账户的显示数据
 */
interface AccountDisplayData {
  id: string;
  label?: string;
  level?: string;
  subscription?: import('../shared/types').SubscriptionInfo;
  error?: string;
  quotas: QuotaDisplayItem[];
  history1d: SharedUsageRecord[];
  history7d: SharedUsageRecord[];
  history30d: SharedUsageRecord[];
  totalTokens1d: number;
  totalTokens7d: number;
  totalTokens30d: number;
  estimatedCost1d: number;
  estimatedCost7d: number;
  estimatedCost30d: number;
  modelRates?: Record<string, number>;
  mcpHistory1d: SharedMcpUsageRecord[];
  mcpHistory7d: SharedMcpUsageRecord[];
  mcpHistory30d: SharedMcpUsageRecord[];
  modelHistory1d: SharedModelTokenRecord[];
  modelHistory7d: SharedModelTokenRecord[];
  modelHistory30d: SharedModelTokenRecord[];
  performanceHistory7d: SharedPerformanceRecord[];
  performanceHistory15d: SharedPerformanceRecord[];
  performanceHistory30d: SharedPerformanceRecord[];
  serviceStatus?: import('../shared/types').DeepSeekServiceComponent[];
}

/**
 * Provider 显示数据（含多个账户）
 */
interface ProviderDisplayData {
  key: string;
  name: string;
  websiteUrl?: string;
  accounts: AccountDisplayData[];
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
/**
 * DeepSeek 网页登录：弹出 BrowserWindow 让用户登录，提取 session token
 */
function deepseekWebLogin(accountId: string): Promise<{ success: boolean; error?: string }> {
  return new Promise((resolve) => {
    const existing = loginWindows.get(accountId);
    if (existing && !existing.isDestroyed()) {
      existing.focus();
      resolve({ success: false, error: 'Login window already open' });
      return;
    }

    const partition = `persist:deepseek-${accountId}`;

    const win = new BrowserWindow({
      width: 480,
      height: 700,
      autoHideMenuBar: true,
      title: 'DeepSeek Login',
      webPreferences: {
        partition,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
      },
    });

    win.setMenuBarVisibility(false);
    loginWindows.set(accountId, win);

    let resolved = false;

    // 检查并保存 token
    async function checkAndSaveToken(): Promise<boolean> {
      if (resolved || win.isDestroyed()) return false;
      try {
        const tokenJson = await win.webContents.executeJavaScript(
          `localStorage.getItem('userToken')`
        );
        if (!tokenJson) return false;

        const parsed = JSON.parse(tokenJson);
        const token = parsed?.value;
        if (!token) return false;

        resolved = true;
        clearInterval(checkInterval);

        if (configManager) {
          const config = configManager.getConfig();
          if (config) {
            const providers = structuredClone(config.providers);
            const ds = providers.deepseek as ProviderTypeConfig;
            if (ds?.accounts) {
              const account = ds.accounts.find(a => a.id === accountId);
              if (account) {
                account.webToken = token;
                account.authMode = 'weblogin';
                account.webUserAgent = win.webContents.getUserAgent();
                await configManager.updateConfig({ providers });
              }
            }
          }
        }

        win.close();
        loginWindows.delete(accountId);

        if (popupWindow && !popupWindow.isDestroyed()) {
          popupWindow.webContents.send('deepseek-web-login-success', accountId);
        }

        resolve({ success: true });
        return true;
      } catch {
        return false;
      }
    }

    // 页面加载完成后立即检查 token
    win.webContents.on('did-finish-load', () => {
      checkAndSaveToken();
    });

    // 轮询检查（兜底）
    const checkInterval = setInterval(() => {
      if (win.isDestroyed()) {
        clearInterval(checkInterval);
        loginWindows.delete(accountId);
        if (!resolved) resolve({ success: false, error: 'Window closed' });
        return;
      }
      checkAndSaveToken();
    }, 1000);

    win.on('closed', () => {
      clearInterval(checkInterval);
      loginWindows.delete(accountId);
      if (!resolved) resolve({ success: false, error: 'Window closed' });
    });

    win.loadURL('https://platform.deepseek.com');
  });
}

/**
 * DeepSeek 网页登出：清除 webToken 和 session 数据
 */
async function deepseekWebLogout(accountId: string): Promise<void> {
  if (!configManager) return;
  const config = configManager.getConfig();
  if (!config) return;

  const providers = structuredClone(config.providers);
  const ds = providers.deepseek as ProviderTypeConfig;
  if (ds?.accounts) {
    const account = ds.accounts.find(a => a.id === accountId);
    if (account) {
      account.webToken = '';
      account.authMode = 'apikey';
      await configManager.updateConfig({ providers });
    }
  }

  // 清除 session partition 数据
  const partition = `persist:deepseek-${accountId}`;
  const ses = session.fromPartition(partition);
  await ses.clearStorageData();
}

/**
 * 显示反馈群窗口
 */
function showFeedbackWindow(): void {
  console.log('[Feedback] showFeedbackWindow called');
  const existing = BrowserWindow.getAllWindows().find(w => (w as any)._feedbackId);
  if (existing) {
    console.log('[Feedback] focusing existing window');
    existing.focus();
    return;
  }

  const win = new BrowserWindow({
    width: 320,
    height: 400,
    resizable: false,
    minimizable: false,
    maximizable: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  (win as any)._feedbackId = 'feedback-window';
  win.setMenuBarVisibility(false);

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/feedback.html`);
  } else {
    win.loadFile(path.join(__dirname, '../renderer/feedback.html'));
  }
}

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

  if (process.env.CQB_DEVTOOLS === '1') {
    popupWindow.webContents.openDevTools({ mode: 'detach' });
  }
}

/**
 * 绑定 blur 监听器（Pinned 模式专用）
 */
function attachBlurHandler(): void {
  detachBlurHandler();
  if (isLocked) return;
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
 * 隐藏弹出窗口
 * 内存节省模式：销毁窗口释放渲染进程
 * 默认模式：将窗口移到屏幕外
 */
function hidePopupWindow(): void {
  if (!popupWindow || popupWindow.isDestroyed()) return;
  detachBlurHandler();

  if (isMemorySavingMode()) {
    popupWindow.destroy();
    popupWindow = null;
  } else {
    popupWindow.setBounds({ x: -9999, y: -9999, width: POPUP_WIDTH, height: POPUP_HEIGHT });
  }

  isPopupVisible = false;
  popupMode = PopupMode.Hidden;
  isLocked = false;
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
      popupWindow.focus();
      // DevTools 打开会抢走焦点，延迟绑定 blur 并重新聚焦
      if (process.env.CQB_DEVTOOLS === '1') {
        setTimeout(() => {
          attachBlurHandler();
          popupWindow?.focus();
        }, 500);
      } else {
        attachBlurHandler();
      }
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
    if (configManager?.getConfig()?.popupTrigger === 'click') return;
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
  // 内存节省模式下不预创建，按需创建/销毁
  if (!isMemorySavingMode()) {
    createPopupWindow();
  }

  // 4. 创建调度器
  scheduler = createScheduler(config);
  scheduler.setTrayManager(trayManager);
  scheduler.setDisplayRule(config.trayDisplayRule ?? 'lowest');

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

  // 10. 启动自动更新检查
  // 模拟更新模式：写入模拟版本到会话内存
  if (mockUpdate) {
    const currentVersion = app.getVersion();
    const parts = currentVersion.split('.').map(Number);
    parts[2] = (parts[2] || 0) + 1;
    const mockVersion = parts.join('.');
    sessionUpdateInfo = { version: mockVersion, downloaded: false };
    console.log(`[AutoUpdate] Mock mode: simulated v${mockVersion}`);
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

    // 更新图标显示规则（不需要重新请求数据，直接用已有数据重新计算）
    if (newConfig.trayDisplayRule !== oldConfig?.trayDisplayRule) {
      scheduler!.setDisplayRule(newConfig.trayDisplayRule ?? 'lowest');
    }

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

    // 内存节省模式变化时，立即应用
    if (newConfig.memorySavingMode !== oldConfig?.memorySavingMode) {
      if (newConfig.memorySavingMode && popupWindow && !popupWindow.isDestroyed() && !isPopupVisible) {
        // 开启模式 + 窗口隐藏中 → 销毁窗口
        popupWindow.destroy();
        popupWindow = null;
        console.log('[App] Memory saving mode enabled, destroyed hidden window');
      } else if (!newConfig.memorySavingMode && !popupWindow) {
        // 关闭模式 + 窗口不存在 → 预创建窗口
        createPopupWindow();
        console.log('[App] Memory saving mode disabled, pre-created window');
      }
    }

    // 自动更新检查开关变化时，启停调度器
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
  // 开发模式下跳过自启注册，避免将 electron.exe 路径写入系统启动项
  if (!app.isPackaged) {
    console.log('[App] Auto-start skipped: running in development mode');
    return;
  }
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

  // 窗口锁定状态切换
  ipcMain.on('set-window-pinned', (_, pinned: boolean) => {
    isLocked = pinned;
    if (pinned && popupMode === PopupMode.Hover) {
      showPopupWindow(PopupMode.Pinned);
    }
    if (popupMode === PopupMode.Pinned) {
      pinned ? detachBlurHandler() : attachBlurHandler();
    }
    popupWindow?.webContents.send('window-pinned-state', pinned);
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
    const config = configManager?.getConfig();
    return config ? { ...config, isPackaged: app.isPackaged, updateInfo: sessionUpdateInfo } : null;
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
    if (isDev && !mockUpdate) {
      return { available: false };
    }
    if (mockUpdate) {
      const currentVersion = app.getVersion();
      const parts = currentVersion.split('.').map(Number);
      parts[2] = (parts[2] || 0) + 1;
      const mockVersion = parts.join('.');
      sessionUpdateInfo = { version: mockVersion, downloaded: false };
      return { available: true, version: mockVersion };
    }
    if (isAutoChecking) {
      return { available: false };
    }
    isAutoChecking = true;
    try {
      const result = await autoUpdater.checkForUpdates();
      if (result?.updateInfo) {
        const latestVersion = result.updateInfo.version;
        const currentVersion = app.getVersion();
        const available = latestVersion > currentVersion;
        if (available) {
          sessionUpdateInfo = { version: latestVersion, downloaded: false };
        } else {
          sessionUpdateInfo = null;
        }
        await configManager?.updateConfig({
          lastAutoCheckTime: new Date().toISOString()
        });
        return { available, version: latestVersion };
      }
      return { available: false };
    } catch {
      return { available: false, error: true };
    } finally {
      isAutoChecking = false;
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
    // 先同步销毁资源，避免 NSIS 检测到旧进程仍在运行
    if (popupWindow && !popupWindow.isDestroyed()) {
      popupWindow.destroy();
      popupWindow = null;
    }
    trayManager?.destroy();
    trayManager = null;
    scheduler?.destroy();
    scheduler = null;
    configManager?.destroy();
    configManager = null;
    autoUpdater.quitAndInstall();
  });

  // 用系统浏览器打开链接
  ipcMain.handle('open-external', async (_, url: string) => {
    await shell.openExternal(url);
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
    const loaded = (scheduler as any)?.providers as import('./loader').LoadedProvider[] | undefined;
    if (!loaded) return [];
    const provider = loaded.find(p => p.accountId === accountId && p.instance instanceof DeepSeekProvider);
    if (!provider) return [];
    try {
      return await (provider.instance as DeepSeekProvider).fetchMonthModelHistory(provider.config, month, year);
    } catch (e) {
      console.warn('[DeepSeek] Failed to fetch month usage:', e);
      return [];
    }
  });
}

/**
 * 检查当前配置是否有启用的 Provider
 */
function hasEnabledProviders(): boolean {
  const config = configManager?.getConfig();
  if (!config) return false;
  return Object.values(config.providers).some(p => {
    const accounts = (p as ProviderTypeConfig).accounts;
    return Array.isArray(accounts) && accounts.some(a => {
      if (!a.enabled) return false;
      if (a.authMode === 'weblogin') return !!a.webToken?.trim();
      return !!a.apiKey?.trim();
    });
  });
}

/**
 * 拆分复合键 "providerType:accountId"
 */
function splitCompoundKey(key: string): [string, string] {
  const idx = key.indexOf(':');
  if (idx === -1) return [key, ''];
  return [key.slice(0, idx), key.slice(idx + 1)];
}

/**
 * 获取账户标签
 */
function getAccountLabel(type: string, accountId: string): string {
  const config = configManager?.getConfig();
  const providerConfig = config?.providers[type] as ProviderTypeConfig | undefined;
  if (!providerConfig?.accounts) return '';
  const account = providerConfig.accounts.find(a => a.id === accountId);
  return account?.label ?? '';
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
      overallPercent: -1
    };
  }

  const aggregated = scheduler.getAggregatedData();
  const thresholds = scheduler.getThresholds();

  // 有启用的 Provider 但首次请求尚未完成，返回 null 让渲染进程保持骨架屏
  if (!aggregated) {
    return null;
  }

  // 按 provider type 分组
  const grouped = new Map<string, Array<{ accountId: string; result: UsageResult }>>();
  for (const [compoundKey, result] of aggregated.results.entries()) {
    const [type, accountId] = splitCompoundKey(compoundKey);
    if (!grouped.has(type)) grouped.set(type, []);
    grouped.get(type)!.push({ accountId, result });
  }

  // 转换为 renderer 期望的格式
  const providers: ProviderDisplayData[] = [];
  for (const [type, accounts] of grouped.entries()) {
    providers.push({
      key: type,
      name: getProviderDisplayName(type),
      websiteUrl: buildConfig.providers.find(p => p.key === type)?.websiteUrl || undefined,
      accounts: accounts.map(({ accountId, result }) =>
        convertAccountData(type, accountId, result, thresholds)
      ),
    });
  }

  return {
    providers,
    lastUpdate: aggregated.lastUpdate.toISOString(),
    overallPercent: scheduler.getDisplayPercent(aggregated.results)
  };
}

/**
 * 转换单个账户数据为显示格式
 */
function convertAccountData(
  type: string,
  accountId: string,
  result: UsageResult,
  thresholds: { green: number; yellow: number }
): AccountDisplayData {
  const quotas: QuotaDisplayItem[] = (result.details?.quotas ?? []).map(q => ({
    label: q.label,
    labelParams: (q as any).labelParams,
    used: q.used,
    total: q.total,
    usageRate: q.usageRate,
    resetAt: q.resetAt,
    startAt: (q as any).startAt,
    color: getColorByPercent(100 - q.usageRate, thresholds) as 'green' | 'yellow' | 'red',
    limitType: q.limitType,
    hideBar: (q as any).hideBar,
  }));

  const mapHistory = (key: string): SharedUsageRecord[] =>
    ((result.details?.[key] ?? []) as SharedUsageRecord[]).map(r => ({ date: r.date, used: r.used }));

  const mapMcpHistory = (key: string): SharedMcpUsageRecord[] =>
    ((result.details?.[key] ?? []) as SharedMcpUsageRecord[]).map(r => ({ date: r.date, search: r.search, webRead: r.webRead, zread: r.zread }));

  const mapModelHistory = (key: string): SharedModelTokenRecord[] =>
    ((result.details?.[key] ?? []) as SharedModelTokenRecord[]).map(r => ({ date: r.date, model: r.model, used: r.used }));

  const mapPerformanceHistory = (key: string): SharedPerformanceRecord[] =>
    ((result.details?.[key] ?? []) as SharedPerformanceRecord[]).map(r => ({
      date: r.date,
      liteDecodeSpeed: r.liteDecodeSpeed,
      proMaxDecodeSpeed: r.proMaxDecodeSpeed,
      liteSuccessRate: r.liteSuccessRate,
      proMaxSuccessRate: r.proMaxSuccessRate,
    }));

  console.log(`[Data] ${type}:${accountId} 1d:${mapHistory('history1d').length} 7d:${mapHistory('history7d').length} 30d:${mapHistory('history30d').length}`);

  return {
    id: accountId,
    label: getAccountLabel(type, accountId) || undefined,
    level: result.level,
    subscription: result.details?.subscription as import('../shared/types').SubscriptionInfo | undefined,
    error: result.error,
    quotas,
    history1d: mapHistory('history1d'),
    history7d: mapHistory('history7d'),
    history30d: mapHistory('history30d'),
    totalTokens1d: (result.details?.totalTokens1d as number) ?? 0,
    totalTokens7d: (result.details?.totalTokens7d as number) ?? 0,
    totalTokens30d: (result.details?.totalTokens30d as number) ?? 0,
    estimatedCost1d: (result.details?.estimatedCost1d as number) ?? 0,
    estimatedCost7d: (result.details?.estimatedCost7d as number) ?? 0,
    estimatedCost30d: (result.details?.estimatedCost30d as number) ?? 0,
    modelRates: (result.details?.modelRates as Record<string, number>) ?? undefined,
    mcpHistory1d: mapMcpHistory('mcpHistory1d'),
    mcpHistory7d: mapMcpHistory('mcpHistory7d'),
    mcpHistory30d: mapMcpHistory('mcpHistory30d'),
    modelHistory1d: mapModelHistory('modelHistory1d'),
    modelHistory7d: mapModelHistory('modelHistory7d'),
    modelHistory30d: mapModelHistory('modelHistory30d'),
    performanceHistory7d: mapPerformanceHistory('performanceHistory7d'),
    performanceHistory15d: mapPerformanceHistory('performanceHistory15d'),
    performanceHistory30d: mapPerformanceHistory('performanceHistory30d'),
    serviceStatus: (result.details?.serviceStatus as import('../shared/types').DeepSeekServiceComponent[]) ?? undefined,
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

  // 停止自动更新检查
  stopAutoUpdateChecker();

  // 停止调度器
  scheduler?.destroy();

  // 销毁托盘
  trayManager?.destroy();

  // 销毁配置管理器
  configManager?.destroy();
});

console.log('Coding Quota Bar started');
