import type { AppConfig } from '../shared/types';
import type { LoadedProvider } from './loader';
import { UsageAggregator } from './aggregator';
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
  private refreshInterval: number;
  private thresholds: ColorThresholds;

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
      this.trayManager.updateDisplay(currentData.lowestPercent, this.thresholds);
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
    this.refresh().catch((error) => {
      console.error('[Scheduler] Refresh failed:', error);
    }).finally(() => {
      if (!this.running) return;
      this.timerId = setTimeout(() => this.scheduleNext(), this.refreshInterval);
    });
  }

  /**
   * 停止定时刷新
   */
  stop(): void {
    this.running = false;
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
   */
  async refresh(): Promise<void> {
    if (this.providers.length === 0) {
      // 无 Provider 时清空数据并通知
      this.aggregator.clear();
      if (this.trayManager) {
        this.trayManager.updateDisplay(100, this.thresholds);
      }
      this.emit('refreshed', null);
      return;
    }

    console.log('[Scheduler] Refreshing usage data...');
    const startTime = Date.now();

    try {
      // 汇总所有 Provider 的数据
      const aggregated = await this.aggregator.aggregate(this.providers);

      // 更新托盘显示
      if (this.trayManager) {
        this.trayManager.updateDisplay(aggregated.lowestPercent, this.thresholds);
      }

      const elapsed = Date.now() - startTime;
      console.log(`[Scheduler] Refresh completed in ${elapsed}ms. Lowest: ${aggregated.lowestPercent}%`);

      // 发送刷新完成事件
      this.emit('refreshed', aggregated);
    } catch (error) {
      console.error('[Scheduler] Refresh failed:', error);
      this.emit('error', error);
      throw error;
    }
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
