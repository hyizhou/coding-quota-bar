import { BrowserWindow, screen } from 'electron';
import * as path from 'path';
import type { WindowPinMode } from '../shared/types';
import type { ConfigManager } from './config';
import type { TrayManager } from './tray';

const POPUP_WIDTH = 336;
const POPUP_HEIGHT = 416;

/**
 * 弹窗尺寸核对容差：部分缩放比例下 DIP 与物理像素换算存在 1-2px 取整
 * 误差（如请求 336 读回 337），透明窗口下该偏差不可见，视为正常，
 * 避免误触发销毁重建
 */
const SIZE_TOLERANCE = 2;

/**
 * 窗口显示模式
 */
const enum PopupMode {
  Hover = 'hover',   // 悬浮触发，鼠标离开自动隐藏
  Pinned = 'pinned', // 点击触发，点击外部隐藏
  Hidden = 'hidden'  // 窗口已隐藏（原生 hide）
}

let popupWindow: BrowserWindow | null = null;
let popupMode: PopupMode = PopupMode.Hidden;
let pinMode: WindowPinMode = 'unpinned';
let isHoveringWindow = false;
let isPopupVisible = false;
let hideTimer: ReturnType<typeof setTimeout> | null = null;
let savePositionTimer: ReturnType<typeof setTimeout> | null = null;
let saveSizeTimer: ReturnType<typeof setTimeout> | null = null;
let blurHandler: (() => void) | null = null;
let displayListenerBound = false;

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
 * 性能日志用：当前弹窗运行模式标签
 */
function popupModeLabel(): string {
  return isMemorySavingMode() ? '内存节省' : '常驻';
}

/**
 * 解析弹窗目标尺寸：宽度恒定，高度取用户上次调整值（无则默认）
 * 高度上限钳制到主显示器工作区高度，防止异常配置导致窗口超出屏幕不可用
 */
function getTargetSize(): { width: number; height: number } {
  const saved = _getConfigManager()?.getConfig()?.popupSize;
  const maxH = screen.getPrimaryDisplay().workAreaSize.height;
  let height = POPUP_HEIGHT;
  if (saved && Number.isFinite(saved.height) && saved.height > POPUP_HEIGHT) {
    height = Math.min(Math.round(saved.height), maxH);
  }
  return { width: POPUP_WIDTH, height };
}

/**
 * 计算弹出窗口位置：在托盘图标上方居中显示
 */
function getPopupPosition(): { x: number; y: number } {
  const trayBounds = _getTrayManager()?.getBounds();
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;
  const { height: popupHeight } = getTargetSize();

  let x: number;
  let y: number;

  if (trayBounds) {
    x = Math.round(trayBounds.x + trayBounds.width / 2 - POPUP_WIDTH / 2);
    y = Math.round(trayBounds.y - popupHeight);
  } else {
    x = screenWidth - POPUP_WIDTH;
    y = screenHeight - popupHeight;
  }

  x = Math.max(0, Math.min(x, screenWidth - POPUP_WIDTH));
  y = Math.max(0, Math.min(y, screenHeight - popupHeight));

  return { x, y };
}

/**
 * 将弹窗位置限制在可见显示器范围内
 * 如果位置不在任何显示器上（如显示器已断开），回退到托盘位置
 */
function clampToScreen(x: number, y: number): { x: number; y: number } {
  const displays = screen.getAllDisplays();
  const { height: popupHeight } = getTargetSize();
  for (const display of displays) {
    const { x: dx, y: dy, width, height } = display.workArea;
    // 窗口有任意部分与显示器工作区重叠，保留用户原始位置
    if (x + POPUP_WIDTH > dx && x < dx + width && y + popupHeight > dy && y < dy + height) {
      return { x, y };
    }
  }
  // 窗口完全不在任何显示器上（如显示器已断开），回退到托盘位置
  return getPopupPosition();
}

/**
 * 延迟保存弹窗位置到配置（防抖）
 */
function scheduleSavePosition(): void {
  if (!popupWindow || popupWindow.isDestroyed()) return;
  if (_getConfigManager()?.getConfig()?.rememberPopupPosition !== true) return;
  if (savePositionTimer) {
    clearTimeout(savePositionTimer);
  }
  savePositionTimer = setTimeout(() => {
    savePositionTimer = null;
    if (!popupWindow || popupWindow.isDestroyed()) return;
    const bounds = popupWindow.getBounds();
    const configManager = _getConfigManager();
    if (configManager) {
      configManager.updateConfig({
        popupPosition: { x: bounds.x, y: bounds.y }
      }).catch(err => {
        console.warn('[Popup] Failed to save popup position:', err);
      });
    }
  }, 500);
}

/**
 * 延迟保存弹窗尺寸到配置（防抖）
 * 与位置不同：尺寸按需求无条件记忆，不受 rememberPopupPosition 开关控制
 */
function scheduleSaveSize(): void {
  if (!popupWindow || popupWindow.isDestroyed()) return;
  if (saveSizeTimer) {
    clearTimeout(saveSizeTimer);
  }
  saveSizeTimer = setTimeout(() => {
    saveSizeTimer = null;
    if (!popupWindow || popupWindow.isDestroyed()) return;
    const bounds = popupWindow.getBounds();
    const configManager = _getConfigManager();
    if (configManager) {
      configManager.updateConfig({
        popupSize: { width: bounds.width, height: bounds.height }
      }).catch(err => {
        console.warn('[Popup] Failed to save popup size:', err);
      });
    }
  }, 500);
}

/**
 * 校正弹窗尺寸
 *
 * 显示器缩放比例变化后，窗口内容会立即按新比例渲染，但窗口物理尺寸
 * 可能不会跟着重算，导致内容比窗口大、放不下的部分被裁掉（表现为
 * 窗口缺一块）。此函数将窗口重设为预期尺寸并核对结果；仍不正确时
 * 仅在弹窗从隐藏转为显示的过渡阶段才允许销毁重建（此时页面重载无
 * 感知）；弹窗可见期间绝不重建，避免页面状态丢失。
 */
function correctPopupSize(x: number, y: number): void {
  if (!popupWindow || popupWindow.isDestroyed()) return;

  // 弹窗可见期间以窗口当前实际尺寸为目标（用户可能刚调整过、防抖保存尚未落盘），
  // 避免显示器参数变化等场景把窗口弹回旧尺寸；隐藏→显示过渡期则取持久化尺寸
  const current = popupWindow.getBounds();
  const target = isPopupVisible
    ? { width: Math.max(POPUP_WIDTH, current.width), height: Math.max(POPUP_HEIGHT, current.height) }
    : getTargetSize();

  popupWindow.setBounds({ x, y, width: target.width, height: target.height });

  let bounds = popupWindow.getBounds();
  if (!isSizeAcceptable(bounds.width, bounds.height, target)) {
    // Electron 跨屏幕移动时偶发用移动前所在屏的缩放比例换算尺寸，补设一次
    popupWindow.setBounds({ x, y, width: target.width, height: target.height });
  }

  bounds = popupWindow.getBounds();
  if (isSizeAcceptable(bounds.width, bounds.height, target)) {
    return;
  }

  console.warn(
    '[Popup] correctPopupSize: 尺寸偏差超出容差（两次 setBounds 后），',
    `got ${bounds.width}x${bounds.height}, expected ${target.width}x${target.height},`,
    `visible=${isPopupVisible}`
  );

  if (isPopupVisible) {
    // 可见期间（如点击固定按钮）销毁重建会导致页面重载、固定按钮状态
    // 与主进程脱节，因此改走 setSize（与 setBounds 不同的调用路径），
    // 仍不正确则留待下次隐藏→显示时重建修复
    popupWindow.setSize(target.width, target.height);
    return;
  }

  // 兜底：仅在隐藏→显示过渡阶段销毁重建，新窗口必然按当前缩放计算尺寸
  destroyPopupWindow();
  createPopupWindow({ x, y }, '尺寸兜底重建');
}

function isSizeAcceptable(width: number, height: number, target: { width: number; height: number }): boolean {
  return (
    Math.abs(width - target.width) <= SIZE_TOLERANCE &&
    Math.abs(height - target.height) <= SIZE_TOLERANCE
  );
}

/**
 * 监听显示器参数（分辨率/缩放比例）变化，弹窗可见时校正其尺寸。
 * 事件驱动：仅在操作系统通知显示设置变化时执行，空闲时零开销。
 */
function bindDisplayCorrection(): void {
  if (displayListenerBound) return;
  displayListenerBound = true;

  screen.on('display-metrics-changed', () => {
    // 弹窗不可见时无需校正，下次显示时会由显示时校正逻辑处理
    if (!popupWindow || popupWindow.isDestroyed() || !isPopupVisible) return;

    const bounds = popupWindow.getBounds();
    correctPopupSize(bounds.x, bounds.y);
  });
}

/**
 * 创建悬浮详情面板（启动时调用一次，之后复用 show/hide）
 */
export function createPopupWindow(
  initialPos?: { x: number; y: number },
  reason: string = '启动预创建'
): void {
  if (popupWindow) {
    return;
  }

  const createStart = Date.now();

  // 未指定初始位置时在托盘默认位置创建。隐藏状态下坐标不影响可见性，
  // 但让窗口与真实显示器保持 DPI 关联，可减少跨屏换算误差
  const { x, y } = initialPos ?? getPopupPosition();
  const { width: targetWidth, height: targetHeight } = getTargetSize();

  popupWindow = new BrowserWindow({
    x,
    y,
    width: targetWidth,
    height: targetHeight,
    frame: false,
    transparent: true,
    resizable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false, // 隐藏创建，显示统一由 showPopupWindow 控制
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  // 仅放开纵向调整：最小/最大宽度相同锁死横向，高度下限为默认值、上不封顶
  popupWindow.setMinimumSize(POPUP_WIDTH, POPUP_HEIGHT);
  popupWindow.setMaximumSize(POPUP_WIDTH, 10000);
  const constructedAt = Date.now();
  console.log(`[Popup] perf: [${popupModeLabel()}] BrowserWindow 构造耗时 ${constructedAt - createStart}ms（${reason}）`);

  if (process.env.ELECTRON_RENDERER_URL) {
    popupWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    popupWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  popupWindow.once('ready-to-show', () => {
    console.log(`[Popup] perf: [${popupModeLabel()}] 页面就绪耗时 ${Date.now() - createStart}ms（自创建起）`);
  });

  popupWindow.on('closed', () => {
    popupWindow = null;
  });

  popupWindow.on('move', () => {
    if (isPopupVisible) {
      scheduleSavePosition();
    }
  });

  popupWindow.on('resize', () => {
    if (isPopupVisible) {
      scheduleSaveSize();
    }
  });

  if (process.env.CQB_DEVTOOLS === '1') {
    popupWindow.webContents.openDevTools({ mode: 'detach' });
  }

  bindDisplayCorrection();
}

/**
 * 绑定 blur 监听器（Pinned 模式专用）
 */
export function attachBlurHandler(): void {
  detachBlurHandler();
  if (pinMode !== 'unpinned') return;
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
 * 按当前固定状态应用置顶属性：固定不置顶（桌面模式）取消置顶，其余恒为置顶
 * 覆盖内存节省模式 / 尺寸兜底导致的窗口重建后 alwaysOnTop 复位为 true 的场景
 */
function applyAlwaysOnTop(): void {
  popupWindow?.setAlwaysOnTop(pinMode !== 'pinned-desktop');
}

/**
 * 隐藏弹出窗口
 */
export function hidePopupWindow(): void {
  const hideStart = Date.now();
  if (!popupWindow || popupWindow.isDestroyed()) return;
  detachBlurHandler();

  isPopupVisible = false;

  // 有未保存的位置（用户刚拖动过），立即保存再隐藏，避免丢失
  if (savePositionTimer) {
    clearTimeout(savePositionTimer);
    savePositionTimer = null;
    const bounds = popupWindow.getBounds();
    // 原生 hide() 隐藏后 bounds 恒为真实位置；
    // 负坐标对主屏左侧的副屏是合法值，不能过滤
    _getConfigManager()?.updateConfig({
      popupPosition: { x: bounds.x, y: bounds.y }
    }).catch(err => {
      console.warn('[Popup] Failed to save popup position:', err);
    });
  }

  // 有未保存的尺寸（用户刚调整过），立即保存再隐藏，避免丢失
  if (saveSizeTimer) {
    clearTimeout(saveSizeTimer);
    saveSizeTimer = null;
    const bounds = popupWindow.getBounds();
    _getConfigManager()?.updateConfig({
      popupSize: { width: bounds.width, height: bounds.height }
    }).catch(err => {
      console.warn('[Popup] Failed to save popup size:', err);
    });
  }

  popupMode = PopupMode.Hidden;
  // 隐藏即重置固定状态：恢复置顶属性，并同步 renderer 按钮状态，
  // 避免固定（尤其桌面模式）状态跨显示周期残留
  if (pinMode !== 'unpinned') {
    pinMode = 'unpinned';
    popupWindow.setAlwaysOnTop(true);
    popupWindow.webContents.send('window-pinned-state', 'unpinned');
  }

  const memorySaving = isMemorySavingMode();
  if (memorySaving) {
    popupWindow.destroy();
    popupWindow = null;
  } else {
    // 原生隐藏：不依赖屏幕外坐标，任意多显示器布局下都不会误现，
    // 录屏/截图也不会拍到屏幕外的窗口
    popupWindow.hide();
  }
  console.log(
    `[Popup] perf: [${memorySaving ? '内存节省' : '常驻'}] ` +
    `hidePopupWindow 耗时 ${Date.now() - hideStart}ms（${memorySaving ? 'destroy' : 'hide'}）`
  );
}

/**
 * 显示弹出窗口
 */
export function showPopupWindow(mode: 'hover' | 'pinned'): void {
  const showStart = Date.now();
  const createdInCall = !popupWindow;
  cancelHide();
  isHoveringWindow = false;

  if (!popupWindow) {
    createPopupWindow(undefined, '显示时创建');
  }
  if (popupWindow && !popupWindow.isDestroyed()) {
    const config = _getConfigManager()?.getConfig();
    const savedPos = config?.rememberPopupPosition ? config.popupPosition : undefined;
    const { x, y } = savedPos ? clampToScreen(savedPos.x, savedPos.y) : getPopupPosition();
    correctPopupSize(x, y);
    isPopupVisible = true;
    popupMode = mode === 'hover' ? PopupMode.Hover : PopupMode.Pinned;
    applyAlwaysOnTop();

    if (mode === 'pinned') {
      popupWindow.show();
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
      // 悬浮唤出不抢焦点
      popupWindow.showInactive();
      detachBlurHandler();
    }

    const suffix = createdInCall ? '（含窗口创建）' : '';
    console.log(
      `[Popup] perf: [${popupModeLabel()}] ` +
      `showPopupWindow('${mode}') 耗时 ${Date.now() - showStart}ms${suffix}`
    );
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
 * 设置窗口固定状态（三态：不固定 / 固定置顶 / 固定不置顶）
 */
export function setWindowPinMode(mode: WindowPinMode): void {
  pinMode = mode;
  applyAlwaysOnTop();
  if (popupMode === PopupMode.Pinned) {
    mode !== 'unpinned' ? detachBlurHandler() : attachBlurHandler();
  }
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
  if (savePositionTimer) {
    clearTimeout(savePositionTimer);
    savePositionTimer = null;
  }
  if (saveSizeTimer) {
    clearTimeout(saveSizeTimer);
    saveSizeTimer = null;
  }
  if (popupWindow && !popupWindow.isDestroyed()) {
    popupWindow.destroy();
  }
  popupWindow = null;
}

/**
 * 重置弹窗位置为托盘默认位置
 */
export function resetPopupPosition(): void {
  const configManager = _getConfigManager();
  if (configManager) {
    configManager.updateConfig({ popupPosition: undefined }).catch(err => {
      console.warn('[Popup] Failed to reset popup position:', err);
    });
  }
  if (popupWindow && !popupWindow.isDestroyed() && isPopupVisible) {
    const { x, y } = getPopupPosition();
    correctPopupSize(x, y);
  }
}

/**
 * 重置弹窗尺寸为默认值（位置保持不变）
 */
export function resetPopupSize(): void {
  const configManager = _getConfigManager();
  if (configManager) {
    configManager.updateConfig({ popupSize: undefined }).catch(err => {
      console.warn('[Popup] Failed to reset popup size:', err);
    });
  }
  if (popupWindow && !popupWindow.isDestroyed() && isPopupVisible) {
    const bounds = popupWindow.getBounds();
    popupWindow.setBounds({ x: bounds.x, y: bounds.y, width: POPUP_WIDTH, height: POPUP_HEIGHT });
  }
}
