import type { Provider, ProviderConfig, QuotaItem, UsageResult } from '../shared/types';
import { HttpClientWithRetry } from '../main/http';

interface MiniMaxModelRemains {
  start_time: number;
  end_time: number;
  remains_time: number;
  current_interval_total_count: number;
  current_interval_usage_count: number;
  model_name: string;
  current_weekly_total_count: number;
  current_weekly_usage_count: number;
  weekly_start_time: number;
  weekly_end_time: number;
  weekly_remains_time: number;
}

interface MiniMaxRemainsResponse {
  model_remains: MiniMaxModelRemains[];
  base_resp: {
    status_code: number;
    status_msg: string;
  };
}

function toISODate(ts: number): string {
  if (!Number.isFinite(ts)) return '';
  const d = new Date(ts);
  return isNaN(d.getTime()) ? '' : d.toISOString();
}

export class MiniMaxProvider implements Provider {
  name = 'MiniMax';

  private httpClient = new HttpClientWithRetry(3, 1000);

  async fetchUsage(config: ProviderConfig): Promise<UsageResult> {
    const apiKey = config.apiKey?.trim();
    if (!apiKey) {
      throw new Error('[MiniMax] API Key is required');
    }

    const baseUrl = (config._baseUrl as string) || 'https://www.minimaxi.com';
    const url = `${baseUrl}/v1/token_plan/remains`;

    const resp = await this.httpClient.getJson<MiniMaxRemainsResponse>(url, {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    });

    if (resp.base_resp?.status_code !== 0) {
      throw new Error(`[MiniMax] API error: ${resp.base_resp?.status_msg || 'Unknown error'}`);
    }

    const models = resp.model_remains;
    if (!models?.length) {
      throw new Error('[MiniMax] No model data returned');
    }

    // 找主指标模型（MiniMax-M*），找不到则用第一个
    const mainModel = models.find(m => m.model_name === 'MiniMax-M*') || models[0];

    // 构建 quotas：每个模型的日额度 + 周额度（>0 时）
    const quotas: QuotaItem[] = [];
    for (const m of models) {
      const name = m.model_name;

      // 日额度
      const dailyUsed = m.current_interval_usage_count;
      const dailyTotal = m.current_interval_total_count;
      quotas.push({
        label: 'quota.minimaxDaily',
        used: dailyUsed,
        total: dailyTotal,
        usageRate: dailyTotal > 0 ? Math.round((dailyUsed / dailyTotal) * 100) : 0,
        resetAt: toISODate(m.end_time),
        startAt: toISODate(m.start_time),
        limitType: name,
      });

      // 周额度（>0 时才显示）
      if (m.current_weekly_total_count > 0) {
        const weeklyUsed = m.current_weekly_usage_count;
        const weeklyTotal = m.current_weekly_total_count;
        quotas.push({
          label: 'quota.minimaxWeekly',
          used: weeklyUsed,
          total: weeklyTotal,
          usageRate: weeklyTotal > 0 ? Math.round((weeklyUsed / weeklyTotal) * 100) : 0,
          resetAt: toISODate(m.weekly_end_time),
          startAt: toISODate(m.weekly_start_time),
          limitType: name,
        });
      }
    }

    const used = mainModel.current_interval_usage_count;
    const total = mainModel.current_interval_total_count;

    return {
      used,
      total,
      expiresAt: toISODate(mainModel.end_time),
      details: {
        quotas,
      },
    };
  }
}
