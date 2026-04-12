import { Tray, Menu, nativeImage, MenuItem } from 'electron';
import * as zlib from 'node:zlib';
import { t } from './i18n';

/**
 * 显示颜色类型
 */
export type DisplayColor = 'green' | 'yellow' | 'red';

/**
 * 颜色配置
 */
const COLORS = {
  green: '#22C55E',
  yellow: '#F59E0B',
  red: '#EF4444'
};

/**
 * 颜色阈值配置
 */
export interface ColorThresholds {
  green: number;  // > green 为绿色
  yellow: number; // > yellow 为黄色，< yellow 为红色
}

/**
 * 托盘事件回调类型
 */
export interface TrayCallbacks {
  onRefresh: () => void;
  onSettings: () => void;
  onAutoStartToggle: (enabled: boolean) => void;
  onQuit: () => void;
}

/**
 * 根据剩余百分比获取显示颜色
 */
export function getColorByPercent(percent: number, thresholds: ColorThresholds): DisplayColor {
  if (percent >= thresholds.green) return 'green';
  if (percent >= thresholds.yellow) return 'yellow';
  return 'red';
}

/**
 * 5x7 像素位图字体 (数字 0-9，加粗)
 */
const DIGIT_FONT: Record<string, string[]> = {
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '10100', '00100', '00100', '00100', '11111'],
  '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  '3': ['01110', '10001', '00001', '00110', '00001', '10001', '01110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  '6': ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
};

/**
 * CRC32 查找表
 */
const CRC_TABLE = (() => {
  const table: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBuf = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crcInput = Buffer.concat([typeBuf, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(crcInput));
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePng(width: number, height: number, rgba: Buffer): Buffer {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type: RGBA

  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    raw[y * (1 + width * 4)] = 0; // filter: none
    rgba.copy(raw, y * (1 + width * 4) + 1, y * width * 4);
  }

  const compressed = zlib.deflateSync(raw);
  return Buffer.concat([
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
}

/**
 * 创建包含数字的托盘图标 (PNG 格式)
 * 使用位图字体渲染百分比数字，生成 PNG 供 Electron NativeImage 使用
 */
export function createTrayIcon(percent: number, color: DisplayColor): Electron.NativeImage {
  const size = 16;
  const colorHex = COLORS[color];

  // 解析颜色
  const r = parseInt(colorHex.slice(1, 3), 16);
  const g = parseInt(colorHex.slice(3, 5), 16);
  const b = parseInt(colorHex.slice(5, 7), 16);

  // 初始化透明像素缓冲
  const pixels = Buffer.alloc(size * size * 4, 0);

  // 渲染数字文本（位图字体 5x7，三位数时间距缩为 0）
  const text = String(Math.round(percent));
  const charWidth = 5;
  const charHeight = 7;
  const charGap = text.length > 2 ? 0 : 1;
  const textWidth = text.length * charWidth + (text.length - 1) * charGap;
  const offsetX = Math.floor((size - textWidth) / 2);
  const offsetY = Math.floor((size - charHeight) / 2);

  for (let ci = 0; ci < text.length; ci++) {
    const glyph = DIGIT_FONT[text[ci]];
    if (!glyph) continue;
    const cx = offsetX + ci * (charWidth + charGap);
    for (let row = 0; row < glyph.length; row++) {
      for (let col = 0; col < glyph[row].length; col++) {
        if (glyph[row][col] === '1') {
          const px = cx + col;
          const py = offsetY + row;
          if (px >= 0 && px < size && py >= 0 && py < size) {
            const idx = (py * size + px) * 4;
            pixels[idx] = r;
            pixels[idx + 1] = g;
            pixels[idx + 2] = b;
            pixels[idx + 3] = 255;
          }
        }
      }
    }
  }

  const pngBuffer = encodePng(size, size, pixels);
  return nativeImage.createFromBuffer(pngBuffer);
}

/**
 * 旋转弧线帧数
 */
const LOADING_FRAMES = 6;
const LOADING_INTERVAL = 180; // ms

/**
 * 创建加载动画的一帧（旋转弧线）
 */
export function createLoadingFrame(frameIndex: number): Electron.NativeImage {
  const size = 16;
  const cx = 7.5;
  const cy = 7.5;
  const radius = 5;

  const pixels = Buffer.alloc(size * size * 4, 0);

  // 弧线覆盖 300°（5/6 圈），缺口 60°，每帧旋转 60°
  const gapAngle = Math.PI / 3; // 60°
  const startAngle = (frameIndex / LOADING_FRAMES) * Math.PI * 2;

  // 灰蓝色弧线
  const cr = 140, cg = 160, cb = 190;

  // 绘制弧线（两层半径让线条更粗一些）
  for (const r of [radius, radius - 1]) {
    for (let a = startAngle; a < startAngle + Math.PI * 2 - gapAngle; a += 0.08) {
      const x = Math.round(cx + r * Math.cos(a));
      const y = Math.round(cy + r * Math.sin(a));
      if (x >= 0 && x < size && y >= 0 && y < size) {
        const idx = (y * size + x) * 4;
        pixels[idx] = cr;
        pixels[idx + 1] = cg;
        pixels[idx + 2] = cb;
        pixels[idx + 3] = 255;
      }
    }
  }

  const pngBuffer = encodePng(size, size, pixels);
  return nativeImage.createFromBuffer(pngBuffer);
}

/**
 * 托盘管理器
 */
export class TrayManager {
  private tray: Tray | null = null;
  private currentPercent = 0;
  private currentColor: DisplayColor = 'green';
  private autoStartEnabled = false;
  private callbacks: TrayCallbacks | null = null;
  private loadingFrame = 0;
  private loadingTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.initialize();
  }

  /**
   * 设置事件回调
   */
  setCallbacks(callbacks: TrayCallbacks): void {
    this.callbacks = callbacks;
  }

  /**
   * 初始化托盘
   */
  private initialize(): void {
    // 创建初始图标
    const icon = createTrayIcon(100, 'green');
    this.tray = new Tray(icon);

    // 设置右键菜单
    this.setupContextMenu();
  }

  /**
   * 设置右键菜单
   */
  private setupContextMenu(): void {
    if (!this.tray) return;

    const contextMenu = Menu.buildFromTemplate([
      {
        label: t('tray.refresh'),
        click: () => this.handleRefresh()
      },
      {
        label: t('tray.settings'),
        click: () => this.handleSettings()
      },
      { type: 'separator' },
      {
        label: t('tray.about'),
        click: () => {
          // TODO: 关于对话框
        }
      },
      {
        label: t('tray.checkUpdate'),
        click: () => {
          // TODO: 检查更新
        }
      },
      { type: 'separator' },
      {
        label: t('tray.quit'),
        click: () => this.handleQuit()
      }
    ]);

    this.tray.setContextMenu(contextMenu);
  }

  /**
   * 处理刷新用量事件
   */
  private handleRefresh(): void {
    console.log('[Tray] Refresh clicked');
    this.callbacks?.onRefresh();
  }

  /**
   * 处理设置事件
   */
  private handleSettings(): void {
    console.log('[Tray] Settings clicked');
    this.callbacks?.onSettings();
  }

  /**
   * 处理开机自启切换事件
   */
  private handleAutoStartToggle(enabled: boolean): void {
    console.log(`[Tray] Auto-start toggled: ${enabled}`);
    this.autoStartEnabled = enabled;
    this.callbacks?.onAutoStartToggle(enabled);
  }

  /**
   * 处理退出事件
   */
  private handleQuit(): void {
    console.log('[Tray] Quit clicked');
    this.callbacks?.onQuit();
  }

  /**
   * 开始加载动画
   */
  startLoading(): void {
    if (this.loadingTimer) return; // 已在加载中
    this.loadingFrame = 0;
    console.log('[Tray] Loading animation started');

    const frame = createLoadingFrame(0);
    this.tray?.setImage(frame);

    this.loadingTimer = setInterval(() => {
      this.loadingFrame = (this.loadingFrame + 1) % LOADING_FRAMES;
      const frame = createLoadingFrame(this.loadingFrame);
      this.tray?.setImage(frame);
    }, LOADING_INTERVAL);
  }

  /**
   * 停止加载动画，切换为正常百分比图标
   */
  stopLoading(): void {
    if (!this.loadingTimer) return;
    clearInterval(this.loadingTimer);
    this.loadingTimer = null;
    console.log('[Tray] Loading animation stopped');

    // 立即显示当前百分比
    if (this.tray) {
      const icon = createTrayIcon(this.currentPercent, this.currentColor);
      this.tray.setImage(icon);
    }
  }

  /**
   * 更新托盘图标显示
   */
  updateDisplay(percent: number, thresholds: ColorThresholds): void {
    const color = getColorByPercent(percent, thresholds);

    // 只有当百分比或颜色变化时才更新
    if (this.currentPercent === percent && this.currentColor === color) {
      return;
    }

    this.currentPercent = percent;
    this.currentColor = color;

    // 加载动画期间不更新图标（由 stopLoading 统一切换）
    if (this.loadingTimer) return;

    if (this.tray) {
      const icon = createTrayIcon(percent, color);
      this.tray.setImage(icon);
    }
  }

  /**
   * 设置开机自启菜单状态
   */
  setAutoStart(enabled: boolean): void {
    if (this.autoStartEnabled !== enabled) {
      this.autoStartEnabled = enabled;
      // 重新构建菜单以更新勾选状态
      this.setupContextMenu();
      console.log(`[Tray] Auto-start menu updated: ${enabled}`);
    }
  }

  /**
   * 重建托盘菜单（语言切换后调用）
   */
  rebuildMenu(): void {
    this.setupContextMenu();
  }

  /**
   * 注册点击事件
   */
  onClick(callback: () => void): void {
    this.tray?.on('click', callback);
  }

  /**
   * 注册鼠标进入事件
   */
  onMouseEnter(callback: () => void): void {
    this.tray?.on('mouse-enter', callback);
  }

  /**
   * 注册鼠标离开事件
   */
  onMouseLeave(callback: () => void): void {
    this.tray?.on('mouse-leave', callback);
  }

  /**
   * 获取托盘图标的屏幕边界矩形
   */
  getBounds(): Electron.Rectangle | null {
    return this.tray?.getBounds() ?? null;
  }

  /**
   * 销毁托盘
   */
  destroy(): void {
    if (this.loadingTimer) {
      clearInterval(this.loadingTimer);
      this.loadingTimer = null;
    }
    if (this.tray) {
      this.tray.destroy();
      this.tray = null;
    }
  }
}
