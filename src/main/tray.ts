import { Tray, Menu, nativeImage, MenuItem, screen, BrowserWindow } from 'electron';
import * as zlib from 'node:zlib';
import { t } from './i18n';
import { isStoreBuild } from './channel';

/**
 * 显示颜色类型
 */
export type DisplayColor = 'green' | 'yellow' | 'red' | 'gray';

/**
 * 颜色配置
 */
const COLORS = {
  green: '#22C55E',
  yellow: '#F59E0B',
  red: '#EF4444',
  gray: '#888888'
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
  onCheckUpdate: () => void;
  onResetPopupPosition: () => void;
  onResetPopupSize: () => void;
  onQuit: () => void;
}

/**
 * 根据剩余百分比获取显示颜色
 */
export function getColorByPercent(percent: number, thresholds: ColorThresholds): DisplayColor {
  if (percent < 0) return 'gray';
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
  '-': ['00000', '00000', '00000', '11111', '00000', '00000', '00000'],
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
 * macOS 托盘图标渲染参数
 * 菜单栏高度是固定逻辑值（与 4K/2K/HD 分辨率无关），因此"自适应"的正确做法是：
 * 逻辑尺寸恒定 16pt + 物理像素按显示器缩放因子 × 2 超采样。
 * 这样任意分辨率/缩放组合下图标视觉大小一致且锐利。
 */
function trayRenderConfig(): { physical: number; sf: number } {
  let displayScale = 1;
  try {
    // screen 仅可在 app ready 后使用；托盘创建于 ready 之后，异常时回退 2x
    displayScale = Math.max(1, screen.getPrimaryDisplay().scaleFactor);
  } catch {
    displayScale = 2;
  }
  const sf = Math.max(2, Math.round(displayScale * 2));
  return { physical: 16 * sf, sf };
}

/**
 * 创建包含数字的托盘图标 (PNG 格式)
 * 使用位图字体渲染百分比数字，生成 PNG 供 Electron NativeImage 使用
 *
 * - Windows：保持原有 16×16 居中渲染不变
 * - macOS：数字铺满图标高度（约为旧版的 2 倍大），物理像素按显示器缩放超采样
 * - macOS：系统字体矢量渲染（见 renderTrayIcon），本函数仅作同步兜底
 */
export function createBitmapTrayIcon(percent: number, color: DisplayColor): Electron.NativeImage {
  if (process.platform !== 'darwin') {
    const size = 16;
    const colorHex = COLORS[color];

    // 解析颜色
    const r = parseInt(colorHex.slice(1, 3), 16);
    const g = parseInt(colorHex.slice(3, 5), 16);
    const b = parseInt(colorHex.slice(5, 7), 16);

    // 初始化透明像素缓冲
    const pixels = Buffer.alloc(size * size * 4, 0);

    // 渲染文本（位图字体 5x7）
    const noData = percent < 0;
    const text = noData ? '--' : String(Math.round(percent));
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

  // —— macOS：数字铺满图标高度 ——
  const { physical, sf } = trayRenderConfig();
  const u = Math.max(1, Math.floor(physical / 8)); // 字体基本单元：字高占图标 7/8
  const colorHex = COLORS[color];

  // 解析颜色
  const r = parseInt(colorHex.slice(1, 3), 16);
  const g = parseInt(colorHex.slice(3, 5), 16);
  const b = parseInt(colorHex.slice(5, 7), 16);

  const noData = percent < 0;
  const text = noData ? '--' : String(Math.round(percent));
  const charWidth = 5 * u;
  const charHeight = 7 * u;
  const charGap = (text.length > 2 ? 0 : 1) * u;
  const textWidth = text.length * charWidth + (text.length - 1) * charGap;
  const width = textWidth + 2 * u; // 左右各留 1u 边距
  const height = charHeight + 2 * u; // 上下各留 1u 边距
  const offsetX = u;
  const offsetY = Math.floor((height - charHeight) / 2);

  const pixels = Buffer.alloc(width * height * 4, 0);

  for (let ci = 0; ci < text.length; ci++) {
    const glyph = DIGIT_FONT[text[ci]];
    if (!glyph) continue;
    const cx = offsetX + ci * (charWidth + charGap);
    for (let row = 0; row < glyph.length; row++) {
      for (let col = 0; col < glyph[row].length; col++) {
        if (glyph[row][col] === '1') {
          // 单元格按 u×u 实心放大
          for (let dy = 0; dy < u; dy++) {
            for (let dx = 0; dx < u; dx++) {
              const px = cx + col * u + dx;
              const py = offsetY + row * u + dy;
              if (px >= 0 && px < width && py >= 0 && py < height) {
                const idx = (py * width + px) * 4;
                pixels[idx] = r;
                pixels[idx + 1] = g;
                pixels[idx + 2] = b;
                pixels[idx + 3] = 255;
              }
            }
          }
        }
      }
    }
  }

  const pngBuffer = encodePng(width, height, pixels);
  return nativeImage.createFromBuffer(pngBuffer, { scaleFactor: sf });
}

// ---------------------------------------------------------------------------
// macOS 系统字体矢量渲染（数字托盘图标）
// ---------------------------------------------------------------------------

let textWindow: BrowserWindow | null = null;
const textIconCache = new Map<string, Electron.NativeImage>();

/**
 * 离屏文本渲染窗口：承载系统字体排版，供 capture 后转托盘图标
 */
async function ensureTextWindow(): Promise<BrowserWindow> {
  if (textWindow && !textWindow.isDestroyed()) return textWindow;
  textWindow = new BrowserWindow({
    show: false,
    x: 0, y: 0, width: 160, height: 48,
    frame: false, transparent: true, resizable: false, movable: false,
    minimizable: false, maximizable: false, fullscreenable: false,
    skipTaskbar: true, focusable: false, hasShadow: false,
    webPreferences: { offscreen: true, backgroundThrottling: false },
  });
  const html =
    '<!doctype html><html><head><meta charset="utf-8"><style>'
    + 'html,body{margin:0;padding:0;background:transparent;overflow:hidden}'
    + '#t{position:absolute;left:0;top:0;white-space:pre;font-weight:600;line-height:1;'
    + "font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',system-ui,sans-serif;"
    + 'font-variant-numeric:tabular-nums;}'
    + '</style></head><body><span id="t"></span></body></html>';
  await textWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  return textWindow;
}

/**
 * 裁剪透明边距，取实际内容包围盒（BGRA）
 */
function trimTransparent(img: Electron.NativeImage): { data: Buffer; width: number; height: number } | null {
  const { width: w, height: h } = img.getSize();
  const bmp = img.toBitmap();
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (bmp[(y * w + x) * 4 + 3] > 8) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  const cw = maxX - minX + 1;
  const ch = maxY - minY + 1;
  const out = Buffer.alloc(cw * ch * 4);
  for (let y = 0; y < ch; y++) {
    const src = ((y + minY) * w + minX) * 4;
    bmp.copy(out, y * cw * 4, src, src + cw * 4);
  }
  return { data: out, width: cw, height: ch };
}

/**
 * 等待离屏窗口下一次 paint（内容变更后触发）
 */
function nextPaint(wc: Electron.WebContents): Promise<Electron.NativeImage | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (img: Electron.NativeImage | null) => {
      if (settled) return;
      settled = true;
      wc.removeListener('paint', onPaint);
      clearTimeout(timer);
      resolve(img);
    };
    const onPaint = (_e: unknown, _d: unknown, image: Electron.NativeImage) => finish(image);
    const timer = setTimeout(() => finish(null), 1500);
    wc.on('paint', onPaint);
  });
}

/**
 * 用系统字体渲染托盘数字图标（macOS）
 * 矢量字体 + 系统抗锯齿，替代点阵字模；失败时回退 createBitmapTrayIcon
 */
export async function renderTrayIcon(percent: number, color: DisplayColor): Promise<Electron.NativeImage> {
  if (process.platform !== 'darwin') return createBitmapTrayIcon(percent, color);

  const key = `${percent}|${color}`;
  const cached = textIconCache.get(key);
  if (cached) return cached;

  try {
    const win = await ensureTextWindow();
    const wc = win.webContents;
    const ds = Math.max(1, screen.getPrimaryDisplay().scaleFactor);
    const colorHex = COLORS[color];
    const text = percent < 0 ? '--' : String(Math.round(percent));

    const js = `(function(){
      const el = document.getElementById('t');
      el.textContent = ${JSON.stringify(text)};
      el.style.color = '${colorHex}';
      return Math.ceil(el.getBoundingClientRect().width);
    })()`;

    await wc.executeJavaScript(js, true);
    const img = await nextPaint(wc);
    if (!img || img.isEmpty()) throw new Error('empty paint');
    const trimmed = trimTransparent(img);
    if (!trimmed) throw new Error('blank paint');

    const out = nativeImage.createFromBitmap(trimmed.data, {
      width: trimmed.width,
      height: trimmed.height,
      scaleFactor: ds,
    });
    if (textIconCache.size > 60) textIconCache.clear();
    textIconCache.set(key, out);
    return out;
  } catch (error) {
    console.warn('[Tray] Font icon render failed, falling back to bitmap:', error);
    return createBitmapTrayIcon(percent, color);
  }
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
  // Windows 保持原有 16×16；macOS 按显示器缩放超采样（逻辑 16pt 恒定）
  const { physical, sf } =
    process.platform === 'darwin' ? trayRenderConfig() : { physical: 16, sf: 1 };
  const size = physical;
  const k = size / 16; // 相对原 16px 设计稿的缩放系数
  const cx = 7.5 * k;
  const cy = 7.5 * k;
  const radius = 5 * k;

  const pixels = Buffer.alloc(size * size * 4, 0);

  // 弧线覆盖 300°（5/6 圈），缺口 60°，每帧旋转 60°
  const gapAngle = Math.PI / 3; // 60°
  const startAngle = (frameIndex / LOADING_FRAMES) * Math.PI * 2;

  // 灰蓝色弧线
  const cr = 140, cg = 160, cb = 190;

  // 绘制弧线（macOS 线宽随物理尺寸缩放；Windows 保持原有两环）
  const rings =
    process.platform === 'darwin'
      ? [radius, radius - k, radius - 2 * k]
      : [radius, radius - 1];
  for (const r of rings) {
    for (let a = startAngle; a < startAngle + Math.PI * 2 - gapAngle; a += 0.08 / k) {
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
  return nativeImage.createFromBuffer(pngBuffer, { scaleFactor: sf });
}

/**
 * 托盘管理器
 */
export class TrayManager {
  private tray: Tray | null = null;
  private currentPercent = -1;
  private currentColor: DisplayColor = 'gray';
  private autoStartEnabled = false;
  private callbacks: TrayCallbacks | null = null;
  private loadingFrame = 0;
  private loadingTimer: ReturnType<typeof setInterval> | null = null;
  /** 图标渲染串行链：离屏字体渲染为异步，保证 setIcon 顺序与触发顺序一致 */
  private iconChain: Promise<void> = Promise.resolve();

  constructor() {
    this.initialize();
  }

  /**
   * 异步刷新托盘图标（macOS 走系统字体渲染，失败回退点阵；渲染请求串行化防止乱序）
   */
  private refreshIcon(): void {
    this.iconChain = this.iconChain
      .then(async () => {
        if (!this.tray) return;
        const icon = await renderTrayIcon(this.currentPercent, this.currentColor);
        if (this.loadingTimer) return; // 加载动画已接管，放弃过期渲染
        this.tray.setImage(icon);
      })
      .catch(() => {
        /* renderTrayIcon 内部已兜底 */
      });
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
    // 初始图标先用点阵灰色 "--" 同步占位，随后异步替换为系统字体渲染版
    const icon = createBitmapTrayIcon(-1, 'gray');
    this.tray = new Tray(icon);

    // 设置右键菜单
    this.setupContextMenu();

    // 异步刷新为字体渲染图标
    this.refreshIcon();
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
      // 商店版更新由微软商店托管，不显示"检查更新"入口
      ...(isStoreBuild() ? [] : [{
        label: t('tray.checkUpdate'),
        click: () => this.handleCheckUpdate()
      }]),
      {
        label: t('tray.resetPosition'),
        click: () => this.callbacks?.onResetPopupPosition()
      },
      {
        label: t('tray.resetSize'),
        click: () => this.callbacks?.onResetPopupSize()
      },
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
   * 处理检查更新事件
   */
  private handleCheckUpdate(): void {
    console.log('[Tray] Check update clicked');
    this.callbacks?.onCheckUpdate();
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
    this.refreshIcon();
  }

  /**
   * 更新托盘图标显示
   */
  updateDisplay(percent: number | null, thresholds: ColorThresholds): void {
    const pct = percent ?? -1;
    const color = getColorByPercent(pct, thresholds);

    // 只有当百分比或颜色变化时才更新
    if (this.currentPercent === pct && this.currentColor === color) {
      return;
    }

    this.currentPercent = pct;
    this.currentColor = color;

    // 加载动画期间不更新图标（由 stopLoading 统一切换）
    if (this.loadingTimer) return;

    this.refreshIcon();
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
