import { BrowserWindow, screen } from 'electron';
import * as path from 'path';
import type { ConfigManager } from './config';
import type { TrayManager } from './tray';

const POPUP_WIDTH = 336;
const POPUP_HEIGHT = 416;

/**
 * 窗口显示模式
 */
const enum PopupMode {
  Hover = 'hover',   // 悬浮触发，鼠标离开自动隐藏
  Pinned = 'pinned', // 点击触发，点击外部隐藏
  Hidden = 'hidden'  // 窗口在屏幕外
}

let popupWindow: BrowserWindow | null = null;
let popupMode: PopupMode = PopupMode.Hidden;
let isLocked = false;
let isHoveringWindow = false;
let isPopupVisible = false;
let hideTimer: ReturnType<typeof setTimeout> | null = null;
let blurHandler: (() => void) | null = null;

let _getTrayManager: () => TrayManager | null = () => null;
let _getConfigManager: () => ConfigManager | null = () => null;

export function setPopupManagerDeps(deps: {
  getTrayManager: () => TrayManager | null;
  getConfigManager: () => ConfigManager | null;
}): void {
  _getTrayManager = deps.getTrayManager;
  _getConfigManager = deps.getConfigManager;
}

/**
 * 检查是否启用了内存节省模式
 */
function isMemorySavingMode(): boolean {
  return _getConfigManager()?.getConfig()?.memorySavingMode === true;
}

/**
 * 计算弹出窗口位置：在托盘图标上方居中显示
 */
function getPopupPosition(): { x: number; y: number } {
  const trayBounds = _getTrayManager()?.getBounds();
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;

  let x: number;
  let y: number;

  if (trayBounds) {
    x = Math.round(trayBounds.x + trayBounds.width / 2 - POPUP_WIDTH / 2);
    y = Math.round(trayBounds.y - POPUP_HEIGHT);
  } else {
    x = screenWidth - POPUP_WIDTH;
    y = screenHeight - POPUP_HEIGHT;
  }

  x = Math.max(0, Math.min(x, screenWidth - POPUP_WIDTH));
  y = Math.max(0, Math.min(y, screenHeight - POPUP_HEIGHT));

  return { x, y };
}

/**
 * 创建悬浮详情面板（启动时调用一次，之后复用 show/hide）
 */
export function createPopupWindow(): void {
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
export function attachBlurHandler(): void {
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
export function detachBlurHandler(): void {
  if (blurHandler && popupWindow) {
    popupWindow.off('blur', blurHandler);
    blurHandler = null;
  }
}

/**
 * 隐藏弹出窗口
 */
export function hidePopupWindow(): void {
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
export function showPopupWindow(mode: 'hover' | 'pinned'): void {
  cancelHide();
  isHoveringWindow = false;

  if (!popupWindow) {
    createPopupWindow();
  }
  if (popupWindow && !popupWindow.isDestroyed()) {
    const { x, y } = getPopupPosition();
    popupWindow.setBounds({ x, y, width: POPUP_WIDTH, height: POPUP_HEIGHT });
    isPopupVisible = true;
    popupMode = mode === 'hover' ? PopupMode.Hover : PopupMode.Pinned;

    if (mode === 'pinned') {
      popupWindow.focus();
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
 * 延迟隐藏弹出窗口（Hover 模式专用）
 */
function scheduleHide(): void {
  if (popupMode !== PopupMode.Hover) return;
  cancelHide();
  hideTimer = setTimeout(() => {
    hideTimer = null;
    if (popupMode !== PopupMode.Hover) return;
    if (!popupWindow || popupWindow.isDestroyed() || !isPopupVisible) return;
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
 * 获取当前弹出窗口（供其他模块发送 IPC 消息）
 */
export function getPopupWindow(): BrowserWindow | null {
  return popupWindow;
}

/**
 * 窗口是否可见
 */
export function isPopupVisibleNow(): boolean {
  return isPopupVisible;
}

/**
 * 获取当前 popup 模式
 */
export function getPopupMode(): string {
  return popupMode;
}

/**
 * 设置窗口锁定状态
 */
export function setWindowLocked(locked: boolean): void {
  isLocked = locked;
}

/**
 * 通知鼠标悬浮状态（来自 renderer IPC）
 */
export function notifyHoverState(hovering: boolean): void {
  isHoveringWindow = hovering;
  if (popupMode !== PopupMode.Hover) return;
  if (hovering) {
    cancelHide();
  } else {
    scheduleHide();
  }
}

/**
 * 打开设置：弹出 popup 窗口并切换到设置视图（Pinned 模式）
 */
export function openSettings(options?: { checkUpdate?: boolean }): void {
  if (options?.checkUpdate) {
    popupWindow?.webContents.send('show-settings', options);
  } else {
    showPopupWindow('pinned');
    popupWindow?.webContents.send('show-settings');
  }
}

/**
 * 从托盘悬浮进入
 */
export function onTrayMouseEnter(): void {
  const config = _getConfigManager()?.getConfig();
  if (config?.popupTrigger === 'click') return;
  if (popupMode === PopupMode.Hidden) {
    showPopupWindow('hover');
  }
}

/**
 * 从托盘悬浮离开
 */
export function onTrayMouseLeave(): void {
  scheduleHide();
}

/**
 * 从托盘点击
 */
export function onTrayClick(): void {
  if (popupMode === PopupMode.Pinned) {
    hidePopupWindow();
  } else if (popupMode === PopupMode.Hover) {
    showPopupWindow('pinned');
  } else {
    showPopupWindow('pinned');
  }
}

/**
 * 显示反馈群窗口
 */
export function showFeedbackWindow(): void {
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

/**
 * 销毁弹出窗口（用于退出前清理）
 */
export function destroyPopupWindow(): void {
  if (popupWindow && !popupWindow.isDestroyed()) {
    popupWindow.destroy();
  }
  popupWindow = null;
}
