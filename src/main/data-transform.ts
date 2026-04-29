import { getColorByPercent } from './tray';
import { t as i18nT } from './i18n';
import type { UsageResult, UsageRecord as SharedUsageRecord, McpUsageRecord as SharedMcpUsageRecord, ModelTokenRecord as SharedModelTokenRecord, PerformanceRecord as SharedPerformanceRecord, ProviderTypeConfig } from '../shared/types';
import type { Scheduler } from './scheduler';
import type { ConfigManager } from './config';
import buildConfig from '../../app.build';

/**
 * Renderer 端额度项
 */
export interface QuotaDisplayItem {
  label: string;
  labelParams?: Record<string, string | number>;
  used: number;
  total: number;
  usageRate: number;
  resetAt: string;
  startAt?: string;
  color: 'green' | 'yellow' | 'red';
  limitType?: string;
  currency?: string;
}

/**
 * 单个账户的显示数据
 */
export interface AccountDisplayData {
  id: string;
  label?: string;
  level?: string;
  subscription?: import('../shared/types').SubscriptionInfo;
  error?: string;
  currency?: string;
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
  modelCostHistory30d: import('../shared/types').ModelCostRecord[];
  performanceHistory7d: SharedPerformanceRecord[];
  performanceHistory15d: SharedPerformanceRecord[];
  performanceHistory30d: SharedPerformanceRecord[];
  serviceStatus?: import('../shared/types').DeepSeekServiceComponent[];
}

/**
 * Provider 显示数据（含多个账户）
 */
export interface ProviderDisplayData {
  key: string;
  name: string;
  websiteUrl?: string;
  accounts: AccountDisplayData[];
}

/**
 * Renderer 进程期望的数据格式
 */
export interface UsageDataForRenderer {
  providers: ProviderDisplayData[];
  lastUpdate: string;
  overallPercent: number;
}

let _getConfigManager: () => ConfigManager | null = () => null;
let _getScheduler: () => Scheduler | null = () => null;

export function setDataTransformDeps(deps: {
  getConfigManager: () => ConfigManager | null;
  getScheduler: () => Scheduler | null;
}): void {
  _getConfigManager = deps.getConfigManager;
  _getScheduler = deps.getScheduler;
}

/**
 * 检查当前配置是否有启用的 Provider
 */
function hasEnabledProviders(): boolean {
  const config = _getConfigManager()?.getConfig();
  if (!config) return false;
  return Object.entries(config.providers).some(([type, p]) => {
    const accounts = (p as ProviderTypeConfig).accounts;
    return Array.isArray(accounts) && accounts.some(a => {
      if (!a.enabled) return false;
      if (a.authMode === 'weblogin') {
        // MiMo 使用 Cookie 认证，不需要 webToken
        if (type === 'mimo') return true;
        return !!a.webToken?.trim();
      }
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
  const config = _getConfigManager()?.getConfig();
  const providerConfig = config?.providers[type] as ProviderTypeConfig | undefined;
  if (!providerConfig?.accounts) return '';
  const account = providerConfig.accounts.find(a => a.id === accountId);
  return account?.label ?? '';
}

/**
 * 获取 Provider 显示名称
 */
function getProviderDisplayName(type: string): string {
  return i18nT(`providers.${type}`) || type;
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
    currency: (q as any).currency,
  }));

  const mapHistory = (key: string): SharedUsageRecord[] =>
    ((result.details?.[key] ?? []) as SharedUsageRecord[]).map(r => ({ date: r.date, used: r.used }));

  const mapMcpHistory = (key: string): SharedMcpUsageRecord[] =>
    ((result.details?.[key] ?? []) as SharedMcpUsageRecord[]).map(r => ({ date: r.date, search: r.search, webRead: r.webRead, zread: r.zread }));

  const mapModelHistory = (key: string): SharedModelTokenRecord[] =>
    ((result.details?.[key] ?? []) as SharedModelTokenRecord[]).map(r => ({ date: r.date, model: r.model, used: r.used, requests: (r as any).requests, cacheHitTokens: (r as any).cacheHitTokens, cacheMissTokens: (r as any).cacheMissTokens, responseTokens: (r as any).responseTokens }));

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
    currency: (result.details?.currency as string) || undefined,
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
    modelCostHistory30d: (result.details?.modelCostHistory30d as import('../shared/types').ModelCostRecord[]) ?? [],
    performanceHistory7d: mapPerformanceHistory('performanceHistory7d'),
    performanceHistory15d: mapPerformanceHistory('performanceHistory15d'),
    performanceHistory30d: mapPerformanceHistory('performanceHistory30d'),
    serviceStatus: (result.details?.serviceStatus as import('../shared/types').DeepSeekServiceComponent[]) ?? undefined,
  };
}

/**
 * 构建返回给 renderer 的用量数据
 */
export function buildUsageData(): UsageDataForRenderer | null {
  const scheduler = _getScheduler();
  if (!scheduler) return null;

  if (!hasEnabledProviders()) {
    return {
      providers: [],
      lastUpdate: new Date().toISOString(),
      overallPercent: -1
    };
  }

  const aggregated = scheduler.getAggregatedData();
  const thresholds = scheduler.getThresholds();

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
