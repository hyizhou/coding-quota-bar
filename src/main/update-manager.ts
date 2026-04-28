import { app } from 'electron';
import { autoUpdater } from 'electron-updater';
import type { ConfigManager } from './config';
import type { UpdateStatus } from '../shared/types';
import type { getPopupWindow as GetPopupWindowFn } from './popup-manager';

let _getConfigManager: () => ConfigManager | null = () => null;
let _getPopupWindow: () => BrowserWindow | null = () => null;

// 这些类型在 popup-manager 中定义，这里需要 BrowserWindow
type BrowserWindow = import('electron').BrowserWindow;

let updateStatus: UpdateStatus = { phase: 'idle' };
let isAutoChecking = false;
let autoUpdateTimerId: ReturnType<typeof setTimeout> | null = null;
let statusClearTimer: ReturnType<typeof setTimeout> | null = null;

const isDev = process.env.CQB_DEV === '1';
const mockUpdate = process.env.CQB_MOCK_UPDATE === '1';

export function setUpdateManagerDeps(deps: {
  getConfigManager: () => ConfigManager | null;
  getPopupWindow: () => BrowserWindow | null;
}): void {
  _getConfigManager = deps.getConfigManager;
  _getPopupWindow = deps.getPopupWindow;
}

/**
 * 初始化 autoUpdater 事件监听（在 app startup 时调用一次）
 */
export function initAutoUpdaterEvents(): void {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  if (isDev) {
    autoUpdater.forceDevUpdateConfig = false;
  }

  autoUpdater.on('download-progress', (progress) => {
    console.log(`[Updater] Downloading: ${progress.percent.toFixed(1)}%`);
    setUpdateStatus({ phase: 'downloading', version: updateStatus.version, progress: Math.round(progress.percent) });
  });

  autoUpdater.on('update-downloaded', () => {
    console.log('[Updater] Update downloaded');
    setUpdateStatus({ phase: 'ready', version: updateStatus.version });
  });

  autoUpdater.on('update-not-available', () => {
    console.log('[Updater] No update available');
    if (!isAutoChecking) {
      setUpdateStatus({ phase: 'noUpdate' });
    }
  });

  autoUpdater.on('error', (error) => {
    console.error('[Updater] Error:', error.message);
    if (updateStatus.phase === 'downloading') {
      setUpdateStatus({ phase: 'available', version: updateStatus.version });
    } else if (updateStatus.phase === 'checking') {
      setUpdateStatus({ phase: 'error' });
    }
  });
}

function setUpdateStatus(status: UpdateStatus): void {
  updateStatus = status;
  if (statusClearTimer) { clearTimeout(statusClearTimer); statusClearTimer = null; }
  if (status.phase === 'noUpdate' || status.phase === 'error') {
    statusClearTimer = setTimeout(() => setUpdateStatus({ phase: 'idle' }), 5000);
  }
  const popup = _getPopupWindow();
  if (popup && !popup.isDestroyed()) {
    popup.webContents.send('update-status-changed', status);
  }
}

/**
 * 获取当前更新状态
 */
export function getUpdateStatus(): UpdateStatus {
  return updateStatus;
}

/**
 * 自动更新检查调度器
 */
export function startAutoUpdateChecker(): void {
  const config = _getConfigManager()?.getConfig();
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

  const config = _getConfigManager()?.getConfig();
  if (!config?.autoCheckUpdate) return;

  isAutoChecking = true;
  console.log('[AutoUpdate] Checking for updates...');
  setUpdateStatus({ phase: 'checking' });

  try {
    if (mockUpdate) {
      const currentVersion = app.getVersion();
      const parts = currentVersion.split('.').map(Number);
      parts[2] = (parts[2] || 0) + 1;
      const mockVersion = parts.join('.');
      console.log(`[AutoUpdate] Mock update: v${mockVersion}`);
      setUpdateStatus({ phase: 'available', version: mockVersion });
      return;
    }

    const result = await autoUpdater.checkForUpdates();
    await _getConfigManager()?.updateConfig({
      lastAutoCheckTime: new Date().toISOString()
    });

    if (result?.updateInfo) {
      const latestVersion = result.updateInfo.version;
      const currentVersion = app.getVersion();

      if (latestVersion > currentVersion) {
        console.log(`[AutoUpdate] Update available: v${latestVersion}`);
        setUpdateStatus({ phase: 'available', version: latestVersion });
      } else {
        console.log('[AutoUpdate] No update available');
        setUpdateStatus({ phase: 'idle' });
      }
    } else {
      setUpdateStatus({ phase: 'error' });
    }
  } catch (error) {
    console.error('[AutoUpdate] Check failed:', error);
    setUpdateStatus({ phase: 'error' });
    await _getConfigManager()?.updateConfig({
      lastAutoCheckTime: new Date().toISOString()
    });
  } finally {
    isAutoChecking = false;
  }
}

function scheduleNextAutoCheck(): void {
  const config = _getConfigManager()?.getConfig();
  if (!config?.autoCheckUpdate) return;

  const intervalMs = (config.autoCheckUpdateInterval || 14400) * 1000;
  autoUpdateTimerId = setTimeout(async () => {
    autoUpdateTimerId = null;
    await performAutoCheck();
    scheduleNextAutoCheck();
  }, intervalMs);
}

export function stopAutoUpdateChecker(): void {
  if (autoUpdateTimerId) {
    clearTimeout(autoUpdateTimerId);
    autoUpdateTimerId = null;
  }
}

/**
 * 手动触发检查更新（IPC handler 用）
 */
export async function checkForUpdate(): Promise<void> {
  if (!app.isPackaged && !mockUpdate) {
    setUpdateStatus({ phase: 'noUpdate' });
    return;
  }
  if (mockUpdate) {
    const currentVersion = app.getVersion();
    const parts = currentVersion.split('.').map(Number);
    parts[2] = (parts[2] || 0) + 1;
    const mockVersion = parts.join('.');
    setUpdateStatus({ phase: 'available', version: mockVersion });
    return;
  }
  if (isAutoChecking) {
    return;
  }
  isAutoChecking = true;
  setUpdateStatus({ phase: 'checking' });
  try {
    const result = await autoUpdater.checkForUpdates();
    await _getConfigManager()?.updateConfig({
      lastAutoCheckTime: new Date().toISOString()
    });
    if (result?.updateInfo) {
      const latestVersion = result.updateInfo.version;
      const currentVersion = app.getVersion();
      if (latestVersion > currentVersion) {
        setUpdateStatus({ phase: 'available', version: latestVersion });
      } else {
        setUpdateStatus({ phase: 'noUpdate' });
      }
    } else {
      setUpdateStatus({ phase: 'error' });
    }
  } catch {
    setUpdateStatus({ phase: 'error' });
  } finally {
    isAutoChecking = false;
  }
}

/**
 * 下载更新
 */
export async function downloadUpdate(): Promise<void> {
  if (updateStatus.phase === 'downloading') return;
  setUpdateStatus({ phase: 'downloading', version: updateStatus.version, progress: 0 });
  try {
    await autoUpdater.downloadUpdate();
  } catch {
    setUpdateStatus({ phase: 'available', version: updateStatus.version });
  }
}

/**
 * 模拟更新初始化
 */
export function initMockUpdate(): void {
  if (mockUpdate) {
    const currentVersion = app.getVersion();
    const parts = currentVersion.split('.').map(Number);
    parts[2] = (parts[2] || 0) + 1;
    const mockVersion = parts.join('.');
    setUpdateStatus({ phase: 'available', version: mockVersion });
    console.log(`[AutoUpdate] Mock mode: simulated v${mockVersion}`);
  }
}
