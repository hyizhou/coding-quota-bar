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
  green: '#4CAF50',
  yellow: '#FF9800',
  red: '#F44336'
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
 * 3x5 像素位图字体 (数字 0-9)
 */
const DIGIT_FONT: Record<string, string[]> = {
  '0': ['111', '101', '101', '101', '111'],
  '1': ['010', '110', '010', '010', '111'],
  '2': ['111', '001', '111', '100', '111'],
  '3': ['111', '001', '111', '001', '111'],
  '4': ['101', '101', '111', '001', '001'],
  '5': ['111', '100', '111', '001', '111'],
  '6': ['111', '100', '111', '101', '111'],
  '7': ['111', '001', '001', '010', '010'],
  '8': ['111', '101', '111', '101', '111'],
  '9': ['111', '101', '111', '001', '111'],
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

  // 渲染数字文本（位图字体 3x5，字符间距 1px）
  const text = String(Math.round(percent));
  const charWidth = 3;
  const charHeight = 5;
  const charGap = 1;
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
 * 托盘管理器
 */
export class TrayManager {
  private tray: Tray | null = null;
  private currentPercent = 0;
  private currentColor: DisplayColor = 'green';
  private autoStartEnabled = false;
  private callbacks: TrayCallbacks | null = null;

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
    this.tray.setToolTip(t('tray.tooltip'));

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

    if (this.tray) {
      const icon = createTrayIcon(percent, color);
      this.tray.setImage(icon);
      this.tray.setToolTip(`Coding Quota Bar - ${t('tray.tooltipRemaining', { n: percent })}`);
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
    if (this.tray) {
      this.tray.destroy();
      this.tray = null;
    }
  }
}
