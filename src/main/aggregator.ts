import type { UsageResult } from '../shared/types';
import type { LoadedProvider } from './loader';

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

/**
 * 是否为 Mock 模式（仅 DEV=1 且 QUOTA_MOCK=1 时生效）
 */
const isMockMode = () => process.env.DEV === '1' && process.env.QUOTA_MOCK === '1';

/**
 * 模拟用量数据
 */
/** 生成近7天每小时粒度的伪造历史数据 */
function generateMockHistory(): { date: string; used: number }[] {
  const records: { date: string; used: number }[] = [];
  const now = new Date();
  // 从7天前的0点开始，到当前小时
  const start = new Date(now);
  start.setDate(start.getDate() - 7);
  start.setHours(0, 0, 0, 0);
  for (let t = start.getTime(); t <= now.getTime(); t += 3600000) {
    const d = new Date(t);
    const dateStr = d.toISOString().slice(0, 13); // 'YYYY-MM-DDTHH'
    records.push({ date: dateStr, used: Math.round(500 + Math.random() * 5000) });
  }
  return records;
}

const MOCK_DATA: Record<string, UsageResult> = {
  zhipu: {
    used: 250000,
    total: 1000000,
    expiresAt: new Date(Date.now() + 5 * 3600000).toISOString(),
    level: 'lite',
    details: {
      remainingPercent: 75,
      quotas: [
        { label: '5小时窗口', used: 250000, total: 1000000, usageRate: 25, resetAt: new Date(Date.now() + 5 * 3600000).toISOString() },
        { label: 'MCP额度', used: 12, total: 50, usageRate: 24, resetAt: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1).toISOString() }
      ],
      usageHistory: generateMockHistory()
    }
  },
  minimax: {
    used: 460000,
    total: 500000,
    expiresAt: new Date(Date.now() + 15 * 24 * 3600 * 1000).toISOString(),
    details: {
      remainingPercent: 8,
      quotas: [
        { label: '配额', used: 460000, total: 500000, usageRate: 92, resetAt: new Date(Date.now() + 15 * 24 * 3600 * 1000).toISOString() }
      ],
      usageHistory: generateMockHistory()
    }
  },
  kimi: {
    used: 120000,
    total: 150000,
    expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
    details: {
      remainingPercent: 20,
      quotas: [
        { label: '配额', used: 120000, total: 150000, usageRate: 80, resetAt: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString() }
      ],
      usageHistory: generateMockHistory()
    }
  }
};

/**
 * Provider 用量数据汇总器
 * 收集所有 Provider 的结果并计算最低百分比
 */
export class UsageAggregator {
  private results = new Map<string, UsageResult>();
  private lastUpdate: Date | null = null;

  /**
   * 汇总所有 Provider 的用量数据
   */
  async aggregate(providers: LoadedProvider[]): Promise<AggregatedUsage> {
    // 开发模式：直接使用模拟数据，不发送真实请求
    if (isMockMode()) {
      console.log('[Aggregator] MOCK MODE - using simulated data');
      this.results.clear();
      for (const { type } of providers) {
        const mock = MOCK_DATA[type] || { used: 0, total: 100, expiresAt: '', details: {} };
        this.results.set(type, mock);
      }
      if (this.results.size === 0) {
        // 没有启用的 provider 时，填充所有模拟数据
        for (const [type, data] of Object.entries(MOCK_DATA)) {
          this.results.set(type, data);
        }
      }
      this.lastUpdate = new Date();
      const lowestPercent = this.calculateLowestPercent();
      return { lowestPercent, results: this.results, lastUpdate: this.lastUpdate };
    }

    // 保存旧数据用于失败时回退
    const previousResults = new Map(this.results);
    this.results.clear();

    // 并行请求所有 Provider
    const promises = providers.map(async ({ type, instance, config }) => {
      try {
        const result = await instance.fetchUsage(config);
        return { type, result, success: true };
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        console.error(`[Aggregator] Failed to fetch ${type}:`, errMsg);
        // 失败时保留上次数据（如果有），附加错误信息
        const previous = previousResults.get(type);
        if (previous) {
          console.warn(`[Aggregator] Using previous data for ${type}`);
          previous.error = errMsg;
          return { type, result: previous, success: false };
        }
        // 没有历史数据时返回错误结果
        return {
          type,
          result: { used: 0, total: 100, expiresAt: '', error: errMsg, details: {} },
          success: false
        };
      }
    });

    const outcomes = await Promise.all(promises);

    // 更新结果
    for (const { type, result } of outcomes) {
      this.results.set(type, result);
    }

    this.lastUpdate = new Date();

    // 计算最低百分比
    const lowestPercent = this.calculateLowestPercent();

    console.log(`[Aggregator] Updated. Lowest: ${lowestPercent}%, Providers: ${this.results.size}`);

    return {
      lowestPercent,
      results: this.results,
      lastUpdate: this.lastUpdate
    };
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
      const percent = result.total > 0 ? ((result.total - result.used) / result.total) * 100 : 0;
      minPercent = Math.min(minPercent, percent);
    }

    return Math.round(minPercent * 10) / 10; // 保留一位小数
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
    this.lastUpdate = null;
  }
}
