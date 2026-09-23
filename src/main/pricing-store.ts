/**
 * 智谱定价表远程同步：构建时打包内置副本作为兜底，运行时从 GitHub raw（main 分支）
 * 拉取最新表，校验通过后整体替换生效表（键序即"最新在前"的模型清单顺序）；
 * 拉取/校验失败静默保持现表，下个检查周期天然重试。调价/新模型只需改 pricing/zai-pricing.json 推送 main。
 */
import pricingConfig from '../../pricing/zai-pricing.json';
import { HttpClient } from './http';
import type { ModelPricing, ZaiPricingTable } from '../shared/types';

type BrowserWindow = import('electron').BrowserWindow;

const REMOTE_PRICING_URL =
  'https://raw.githubusercontent.com/hyizhou/coding-quota-bar/main/pricing/zai-pricing.json';

const isDev = process.env.CQB_DEV === '1';

let _getPopupWindow: () => BrowserWindow | null = () => null;

/** 内置表：构建时从 pricing/zai-pricing.json 打包，离线/远程失败时兜底 */
const bundledTable = pricingConfig as unknown as ZaiPricingTable;

/** 当前生效表：初始为内置表，远程拉取成功后被整体替换 */
let currentTable: ZaiPricingTable = bundledTable;

export function setPricingStoreDeps(deps: {
  getPopupWindow: () => BrowserWindow | null;
}): void {
  _getPopupWindow = deps.getPopupWindow;
}

/**
 * 获取当前生效的智谱定价表
 */
export function getZaiPricing(): ZaiPricingTable {
  return currentTable;
}

let refreshPromise: Promise<void> | null = null;

/**
 * 从远程拉取最新定价表（并发去重）；任何失败静默保持现表
 */
export function refreshZaiPricing(): Promise<void> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = fetchRemote().finally(() => {
    refreshPromise = null;
  });
  return refreshPromise;
}

async function fetchRemote(): Promise<void> {
  // 开发模式允许覆盖 URL 以模拟坏数据/不可达场景；生产固定远程地址
  const url = isDev && process.env.CQB_PRICING_URL ? process.env.CQB_PRICING_URL : REMOTE_PRICING_URL;
  try {
    const response = await HttpClient.request(url, { timeout: 10_000 });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`HTTP ${response.status}`);
    }
    const table = validatePricingTable(JSON.parse(response.body));
    currentTable = table;
    console.log(`[Pricing] Remote zai pricing applied (${Object.keys(table.models).length} models)`);
    const popup = _getPopupWindow();
    if (popup && !popup.isDestroyed()) {
      popup.webContents.send('zai-pricing-updated', table);
    }
  } catch (error) {
    // 预期内的网络/校验失败：保持现表（console.error 不受打包零日志屏蔽，禁用）
    console.log(`[Pricing] Remote zai pricing skipped: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isRatio(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

/**
 * 严格校验远程数据结构，任何字段非法即抛错（由调用方保持现表）
 */
function validatePricingTable(data: unknown): ZaiPricingTable {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new Error('root is not an object');
  }
  const { models, tokenRatio } = data as { models?: unknown; tokenRatio?: unknown };

  if (typeof models !== 'object' || models === null || Array.isArray(models)) {
    throw new Error('models is not an object');
  }
  const entries = Object.entries(models);
  if (entries.length === 0) {
    throw new Error('models is empty');
  }
  const validatedModels: Record<string, ModelPricing> = {};
  for (const [name, pricing] of entries) {
    if (typeof pricing !== 'object' || pricing === null || Array.isArray(pricing)) {
      throw new Error(`model ${name} is not an object`);
    }
    const { cache, input, output, tier, note } = pricing as Record<string, unknown>;
    if (!isNonNegativeNumber(cache) || !isNonNegativeNumber(input) || !isNonNegativeNumber(output)) {
      throw new Error(`model ${name} has invalid price`);
    }
    if (tier !== undefined && typeof tier !== 'string') {
      throw new Error(`model ${name} has invalid tier`);
    }
    if (note !== undefined && typeof note !== 'string') {
      throw new Error(`model ${name} has invalid note`);
    }
    validatedModels[name] = { cache, input, output, ...(tier !== undefined ? { tier } : {}), ...(note !== undefined ? { note } : {}) };
  }

  if (typeof tokenRatio !== 'object' || tokenRatio === null || Array.isArray(tokenRatio)) {
    throw new Error('tokenRatio is not an object');
  }
  const ratio = tokenRatio as Record<string, unknown>;
  if (!isRatio(ratio.cache) || !isRatio(ratio.input) || !isRatio(ratio.output)) {
    throw new Error('tokenRatio has invalid value');
  }
  if (Math.abs(ratio.cache + ratio.input + ratio.output - 1) > 0.001) {
    throw new Error('tokenRatio does not sum to 1');
  }

  return { models: validatedModels, tokenRatio: { cache: ratio.cache, input: ratio.input, output: ratio.output } };
}
