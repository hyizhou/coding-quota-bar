import type { UsageResult } from '../shared/types';
import type { LoadedProvider } from './loader';
import { generateMockData } from './mock-data';

/**
 * 聚合后的用量数据
 */
export interface AggregatedUsage {
  /**
   * 最低剩余百分比（供托盘显示）
   */
  lowestPercent: number;

  /**
   * 所有 Provider 的用量结果
   */
  results: Map<string, UsageResult>;

  /**
   * 上次更新时间
   */
  lastUpdate: Date;
}

export interface AggregateOptions {
  /**
   * 仅请求这些复合键（type:accountId）对应的账户，结果合入现有数据；
   * 未包含的账户保留现有结果，不发起请求（用于配置变更后的增量刷新）
   */
  onlyKeys?: Set<string>;
}

/**
 * 是否为 Mock 模式（仅 CQB_DEV=1 且 CQB_MOCK=1 时生效）
 */
const isMockMode = () => process.env.CQB_DEV === '1' && process.env.CQB_MOCK === '1';

/**
 * Provider 用量数据汇总器
 * 收集所有 Provider 的结果并计算最低百分比
 */
export class UsageAggregator {
  private results = new Map<string, UsageResult>();
  private lastUpdate: Date | null = null;
  private generation = 0;
  /** 当前已加载账户的复合键集合：所有完成路径按它过滤与裁剪 */
  private currentKeys = new Set<string>();
  /** 复合键 → 最新占用它的聚合代数：防止在途旧结果覆盖新配置的结果 */
  private claimedKeys = new Map<string, number>();

  /**
   * 汇总所有 Provider 的用量数据
   */
  async aggregate(providers: LoadedProvider[], opts: AggregateOptions = {}): Promise<AggregatedUsage> {
    // 开发模式：直接使用模拟数据，不发送真实请求
    if (isMockMode()) {
      console.log('[Aggregator] MOCK MODE - using simulated data');
      const MOCK_DATA = generateMockData();
      this.results.clear();
      for (const { type, accountId } of providers) {
        const mock = MOCK_DATA[type];
        if (Array.isArray(mock)) {
          // 平铺多卡型 Provider（openrouter）：mock 展示全部场景，与配置账户数无关
          mock.forEach((m, i) => this.results.set(`${type}:mock-${i + 1}`, m));
        } else {
          const compoundKey = `${type}:${accountId}`;
          this.results.set(compoundKey, mock || { used: 0, total: 100, expiresAt: '', details: {} });
        }
      }
      if (this.results.size === 0) {
        // 没有启用的 provider 时，填充所有模拟数据
        for (const [type, data] of Object.entries(MOCK_DATA)) {
          if (Array.isArray(data)) {
            data.forEach((m, i) => this.results.set(`${type}:mock-${i + 1}`, m));
          } else {
            this.results.set(`${type}:mock`, data);
          }
        }
      }
      this.lastUpdate = new Date();
      const lowestPercent = this.calculateLowestPercent();
      return { lowestPercent, results: this.results, lastUpdate: this.lastUpdate };
    }

    // 用代计数器区分并发 aggregate（全量与增量可同时在途）的先后
    const gen = ++this.generation;

    // 增量模式只请求指定账户；providers 仍传完整列表，
    // 保证合并过滤与裁剪始终以最新加载集合为准
    const onlyKeys = opts.onlyKeys;
    const targets = onlyKeys
      ? providers.filter(p => onlyKeys.has(`${p.type}:${p.accountId}`))
      : providers;

    this.currentKeys = new Set(providers.map(p => `${p.type}:${p.accountId}`));
    // 声明本次要请求的键；后启动的聚合会覆盖声明，
    // 在途旧结果完成时若键已被新聚合接管则丢弃（如配置中途被修改）
    for (const { type, accountId } of targets) {
      this.claimedKeys.set(`${type}:${accountId}`, gen);
    }

    // 保存旧数据用于失败时回退
    const previousResults = new Map(this.results);

    // 按服务商分组：不同服务商并行，同服务商内串行避免请求风暴
    const groups = new Map<string, typeof providers>();
    for (const p of targets) {
      if (!groups.has(p.type)) groups.set(p.type, []);
      groups.get(p.type)!.push(p);
    }

    const outcomes = await Promise.all(
      Array.from(groups.entries()).map(async ([, group]) => {
        const results: Array<{ compoundKey: string; result: UsageResult }> = [];
        for (const { type, accountId, instance, config } of group) {
          const compoundKey = `${type}:${accountId}`;
          try {
            const result = await instance.fetchUsage(config);
            // Provider 以 UsageResult.error 返回的错误（TOKEN_EXPIRED/NETWORK_ERROR 等）
            // 不经过 catch 分支，这里统一输出到主进程日志便于排查（打包版 console.warn 为 no-op）
            if (result.error) {
              console.warn(`[Aggregator] ${compoundKey} returned error: ${result.error}`);
            }
            results.push({ compoundKey, result });
          } catch (error) {
            const errMsg = error instanceof Error ? error.message : String(error);
            console.error(`[Aggregator] Failed to fetch ${compoundKey}:`, errMsg);
            const previous = previousResults.get(compoundKey);
            if (previous) {
              console.warn(`[Aggregator] Using previous data for ${compoundKey}`);
              previous.error = errMsg;
              results.push({ compoundKey, result: previous });
            } else {
              results.push({
                compoundKey,
                result: { used: 0, total: 100, expiresAt: '', error: errMsg, details: {} },
              });
            }
          }
        }
        return results;
      })
    );

    const stale = gen !== this.generation;
    for (const groupResults of outcomes) {
      for (const { compoundKey, result } of groupResults) {
        // 键已被更新的聚合接管：旧配置的在途结果不覆盖新结果
        if (this.claimedKeys.get(compoundKey) !== gen) continue;
        // 账户已被禁用/移除：结果不写入
        if (!this.currentKeys.has(compoundKey)) continue;
        this.results.set(compoundKey, result);
      }
    }

    if (!stale) {
      // 裁剪到当前已加载账户集合（禁用/移除/换号的旧键自然丢弃，竞态自愈）
      for (const key of Array.from(this.results.keys())) {
        if (!this.currentKeys.has(key)) this.results.delete(key);
      }
    }

    if (outcomes.length > 0 || !this.lastUpdate) {
      this.lastUpdate = new Date();
    }

    // 计算最低百分比
    const lowestPercent = this.calculateLowestPercent();

    const label = onlyKeys ? `Incremental update (${targets.length} account(s))` : 'Updated';
    console.log(`[Aggregator] ${label}. Lowest: ${lowestPercent}%, Providers: ${this.results.size}`);

    return {
      lowestPercent,
      results: this.results,
      lastUpdate: this.lastUpdate
    };
  }

  /**
   * 按最新已加载账户集合裁剪结果
   * 配置重载时调用，立即清除已禁用/移除账户的残留数据
   */
  pruneTo(providers: LoadedProvider[]): void {
    this.currentKeys = new Set(providers.map(p => `${p.type}:${p.accountId}`));
    for (const key of Array.from(this.results.keys())) {
      if (!this.currentKeys.has(key)) this.results.delete(key);
    }
    for (const key of Array.from(this.claimedKeys.keys())) {
      if (!this.currentKeys.has(key)) this.claimedKeys.delete(key);
    }
  }

  /**
   * 计算单个 result 的剩余百分比
   */
  static calcPercent(result: UsageResult): number {
    // noQuota：服务端明确返回无额度，剩余按 0% 计
    if (result.noQuota) return 0;
    // total 为 0 表示额度刚重置或无法计算，视为 100%（充足）
    return result.total > 0 ? ((result.total - result.used) / result.total) * 100 : 100;
  }

  /**
   * 计算所有 Provider 中最低的剩余百分比
   */
  private calculateLowestPercent(): number {
    if (this.results.size === 0) {
      return 100;
    }

    let minPercent = 100;
    for (const result of this.results.values()) {
      minPercent = Math.min(minPercent, UsageAggregator.calcPercent(result));
    }

    return Math.round(minPercent * 10) / 10;
  }

  /**
   * 获取当前聚合数据（不触发刷新）
   */
  getCurrentData(): AggregatedUsage | null {
    if (!this.lastUpdate) {
      return null;
    }

    return {
      lowestPercent: this.calculateLowestPercent(),
      results: new Map(this.results),
      lastUpdate: this.lastUpdate
    };
  }

  /**
   * 清空所有数据
   */
  clear(): void {
    this.results.clear();
    this.currentKeys = new Set();
    this.claimedKeys.clear();
    this.lastUpdate = null;
  }
}
