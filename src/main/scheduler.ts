import type { AppConfig, TrayDisplayRule, UsageResult } from '../shared/types';
import type { LoadedProvider } from './loader';
import { UsageAggregator } from './aggregator';
import type { AggregatedUsage, AggregateOptions } from './aggregator';
import type { TrayManager, ColorThresholds } from './tray';
import { EventEmitter } from 'events';

/**
 * 调度器状态
 */
export interface SchedulerState {
  isRunning: boolean;
  interval: number;
  lastRefresh: Date | null;
  nextRefresh: Date | null;
}

/**
 * 数据刷新调度器
 * 定时触发 Provider 数据刷新，更新托盘显示
 */
export class Scheduler extends EventEmitter {
  private aggregator: UsageAggregator;
  private trayManager: TrayManager | null = null;
  private providers: LoadedProvider[] = [];
  private timerId: NodeJS.Timeout | null = null;
  private running = false;
  private refreshPromise: Promise<void> | null = null;
  /** 增量刷新待取队列（复合键 type:accountId），配置变更时入队 */
  private pendingKeys = new Set<string>();
  /** 增量排水链路进行标记，保证同一时刻只有一条排水链 */
  private drainPromise: Promise<void> | null = null;
  private scheduleGeneration = 0;
  private refreshInterval: number;
  private thresholds: ColorThresholds;
  private displayRule: TrayDisplayRule = 'lowest';

  constructor(refreshInterval: number = 300000, thresholds: ColorThresholds = { green: 50, yellow: 20 }) {
    super();
    this.aggregator = new UsageAggregator();
    this.refreshInterval = refreshInterval;
    this.thresholds = thresholds;
  }

  /**
   * 设置托盘管理器
   */
  setTrayManager(trayManager: TrayManager): void {
    this.trayManager = trayManager;
  }

  /**
   * 设置 Provider 列表
   */
  setProviders(providers: LoadedProvider[]): void {
    this.providers = providers;
    // 立即裁剪已禁用/移除账户的残留数据；随后的增量排水负责推送最新快照
    this.aggregator.pruneTo(providers);
  }

  /**
   * 设置刷新间隔（毫秒），间隔变化时重启定时器
   * @returns 是否因间隔变化重启了定时器
   */
  setRefreshInterval(interval: number): boolean {
    if (this.refreshInterval === interval) {
      return false;
    }
    this.refreshInterval = interval;
    // 如果正在运行，重启定时器
    if (this.running) {
      this.stop();
      this.start();
    }
    return true;
  }

  /**
   * 设置颜色阈值
   */
  setColorThresholds(thresholds: ColorThresholds): void {
    this.thresholds = thresholds;
    // 立即更新托盘显示
    const currentData = this.aggregator.getCurrentData();
    if (currentData && this.trayManager) {
      const pct = this.calculateDisplayPercent(currentData.results);
      this.trayManager.updateDisplay(pct, this.thresholds);
    }
  }

  /**
   * 设置图标显示规则
   */
  setDisplayRule(rule: TrayDisplayRule): void {
    this.displayRule = rule;
    // 立即更新托盘显示
    const currentData = this.aggregator.getCurrentData();
    if (currentData && this.trayManager) {
      const pct = this.calculateDisplayPercent(currentData.results);
      this.trayManager.updateDisplay(pct, this.thresholds);
    }
  }

  /**
   * 启动定时刷新
   */
  start(): void {
    if (this.running) {
      console.warn('[Scheduler] Already running');
      return;
    }

    this.running = true;
    console.log(`[Scheduler] Starting with interval: ${this.refreshInterval}ms`);
    this.emit('started');
    this.scheduleNext();
  }

  /**
   * 递归调度：刷新完成后等待 interval 再触发下一次
   */
  private scheduleNext(): void {
    // 代数标记：只允许最新一条调度链排下一个 timer，
    // 防止刷新进行中 stop/start（如修改刷新间隔）产生重复调度链
    const generation = ++this.scheduleGeneration;
    this.refresh().catch((error) => {
      console.error('[Scheduler] Refresh failed:', error);
    }).finally(() => {
      if (generation !== this.scheduleGeneration) return;
      if (!this.running) return;
      this.timerId = setTimeout(() => this.scheduleNext(), this.refreshInterval);
    });
  }

  /**
   * 停止定时刷新
   */
  stop(): void {
    this.running = false;
    this.scheduleGeneration++;
    if (this.timerId) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }

    console.log('[Scheduler] Stopped');
    this.emit('stopped');
  }

  /**
   * 检查是否正在运行
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * 手动触发刷新（外部可调用）
   * 全量语义：请求所有已加载账户，但避让 pending 队列中的成员
   */
  refresh(): Promise<void> {
    // in-flight 互斥：刷新进行中时，手动刷新与定时刷新复用同一个 Promise，
    // 避免并发触发多套 Provider 隐藏窗口
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = this.doRefresh().finally(() => {
      this.refreshPromise = null;
    });
    return this.refreshPromise;
  }

  private async doRefresh(): Promise<void> {
    if (this.providers.length === 0) {
      // 无 Provider 时清空数据并通知
      this.aggregator.clear();
      if (this.trayManager) {
        this.trayManager.updateDisplay(null, this.thresholds);
      }
      this.emit('refreshed', null);
      return;
    }

    console.log('[Scheduler] Refreshing usage data...');
    const startTime = Date.now();

    try {
      // 汇总所有 Provider 的数据；pending 成员由增量排水负责，此处避让
      let opts: AggregateOptions | undefined;
      if (this.pendingKeys.size > 0) {
        const onlyKeys = new Set(
          this.providers
            .map(p => `${p.type}:${p.accountId}`)
            .filter(key => !this.pendingKeys.has(key)),
        );
        if (onlyKeys.size === 0) {
          console.log('[Scheduler] Refresh skipped: all accounts are in incremental queue');
          return;
        }
        opts = { onlyKeys };
      }

      // providers 始终传完整列表：聚合的合并过滤与裁剪以最新加载集合为准
      const aggregated = await this.aggregator.aggregate(this.providers, opts);
      this.completeRefresh(aggregated, startTime, 'Refresh');
    } catch (error) {
      console.error('[Scheduler] Refresh failed:', error);
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * 入队增量刷新：只请求新增/配置变化的账户，成功或失败均退出队列
   * keys 为空时不发请求，仅按最新加载集合裁剪快照并推送一次
   */
  queueIncremental(keys: string[]): void {
    for (const key of keys) {
      this.pendingKeys.add(key);
    }
    this.drainPending();
  }

  /**
   * 启动增量排水（单链互斥）：排水期间新入队的键由循环的下一轮处理
   */
  private drainPending(): void {
    if (this.drainPromise) return;
    this.drainPromise = this.drainQueue().finally(() => {
      this.drainPromise = null;
    });
  }

  private async drainQueue(): Promise<void> {
    do {
      const keys = new Set(this.pendingKeys);
      const startTime = Date.now();
      let aggregated: AggregatedUsage | null = null;
      try {
        aggregated = await this.aggregator.aggregate(this.providers, { onlyKeys: keys });
      } catch (error) {
        // 聚合器内部已把单个账户错误转为错误卡结果；这里只处理聚合流程本身的异常
        console.error('[Scheduler] Incremental refresh failed:', error);
        this.emit('error', error);
      } finally {
        // 获得任意结果（含错误卡）即退出队列，等下个全量周期重试
        for (const key of keys) {
          this.pendingKeys.delete(key);
        }
      }
      if (aggregated) {
        this.completeRefresh(
          aggregated,
          startTime,
          keys.size > 0 ? `Incremental refresh (${keys.size} account(s))` : 'Snapshot sync',
        );
      }
    } while (this.pendingKeys.size > 0);
  }

  /**
   * 刷新完成后的统一处理：更新托盘显示并通知渲染层
   */
  private completeRefresh(aggregated: AggregatedUsage, startTime: number, label: string): void {
    const displayPercent = this.calculateDisplayPercent(aggregated.results);
    if (this.trayManager) {
      this.trayManager.updateDisplay(displayPercent, this.thresholds);
    }
    console.log(`[Scheduler] ${label} completed in ${Date.now() - startTime}ms. Display: ${displayPercent}%`);
    this.emit('refreshed', aggregated);
  }

  /**
   * 获取当前状态
   */
  getState(): SchedulerState {
    return {
      isRunning: this.running,
      interval: this.refreshInterval,
      lastRefresh: this.aggregator.getCurrentData()?.lastUpdate || null,
      nextRefresh: this.running
        ? new Date(Date.now() + this.refreshInterval)
        : null
    };
  }

  /**
   * 获取聚合后的用量数据
   */
  getAggregatedData() {
    return this.aggregator.getCurrentData();
  }

  /**
   * 根据显示规则计算百分比（供外部调用，如 buildUsageData）
   */
  getDisplayPercent(results: Map<string, UsageResult>): number {
    return this.calculateDisplayPercent(results);
  }

  /**
   * 根据显示规则从 results 中计算托盘显示百分比
   */
  private calculateDisplayPercent(results: Map<string, UsageResult>): number {
    if (results.size === 0) return -1;

    // compound key 模式：直接取指定账户
    if (this.displayRule !== 'lowest' && this.displayRule !== 'highest') {
      const result = results.get(this.displayRule);
      if (result) {
        return Math.round(UsageAggregator.calcPercent(result) * 10) / 10;
      }
      // 账户不存在（已删除），回退到最低
    }

    if (this.displayRule === 'highest') {
      let maxPercent = 0;
      for (const result of results.values()) {
        maxPercent = Math.max(maxPercent, UsageAggregator.calcPercent(result));
      }
      return Math.round(maxPercent * 10) / 10;
    }

    // lowest（默认）
    let minPercent = 100;
    for (const result of results.values()) {
      minPercent = Math.min(minPercent, UsageAggregator.calcPercent(result));
    }
    return Math.round(minPercent * 10) / 10;
  }

  /**
   * 获取颜色阈值
   */
  getThresholds(): ColorThresholds {
    return this.thresholds;
  }

  /**
   * 销毁调度器
   */
  destroy(): void {
    this.stop();
    this.pendingKeys.clear();
    this.removeAllListeners();
  }
}

/**
 * 从应用配置创建调度器
 */
export function createScheduler(config: AppConfig): Scheduler {
  const thresholds = config.display.colorThresholds;
  const interval = config.refreshInterval * 1000; // 转换为毫秒
  return new Scheduler(interval, thresholds);
}
