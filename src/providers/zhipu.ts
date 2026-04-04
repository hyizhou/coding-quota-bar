import type { Provider, ProviderConfig, UsageResult } from '../shared/types';
import { HttpClientWithRetry } from '../main/http';

/**
 * 智谱 Coding Plan API 响应类型
 */
interface ZhipuLimitItem {
  type: string;
  name: string;
  usage: number;          // 总额度
  currentValue: number;   // 已用量
  percentage: number;      // 已用百分比
  nextResetTime: number;   // 下次重置时间 (毫秒时间戳)
}

interface ZhipuUsageResponse {
  code: number;
  data?: {
    limits: ZhipuLimitItem[];
  };
  msg?: string;
  success?: boolean;
}

/**
 * 智谱 Coding Plan Provider
 */
export class ZhipuProvider implements Provider {
  name = '智谱';

  private readonly API_ENDPOINT = 'https://bigmodel.cn/api/monitor/usage/quota/limit';
  private httpClient = new HttpClientWithRetry(3, 1000);

  async fetchUsage(config: ProviderConfig): Promise<UsageResult> {
    const { apiKey } = config;

    if (!apiKey) {
      throw new Error('[Zhipu] API Key is required');
    }

    try {
      const response = await this.httpClient.getJson<ZhipuUsageResponse>(
        this.API_ENDPOINT,
        {
          'Authorization': `Bearer ${apiKey}`
        }
      );

      if (response.code !== 200 || !response.data?.limits?.length) {
        throw new Error(`[Zhipu] API error: ${response.msg || 'Unknown error'}`);
      }

      // 查找 TOKENS_LIMIT 类型的配额
      const tokenLimit = response.data.limits.find(
        item => item.type === 'TOKENS_LIMIT'
      );

      if (!tokenLimit || tokenLimit.usage <= 0) {
        throw new Error('[Zhipu] No token limit data found');
      }

      const total = tokenLimit.usage;        // 总额度
      const used = tokenLimit.currentValue;   // 已用量
      const remaining = total - used;
      const expiresAt = new Date(tokenLimit.nextResetTime).toISOString();

      return {
        used,
        total,
        expiresAt,
        details: {
          percentage: tokenLimit.percentage,
          remaining,
          remainingPercent: Math.round((remaining / total) * 1000) / 10
        }
      };
    } catch (error) {
      console.error('[Zhipu] Failed to fetch usage:', error);
      throw error;
    }
  }
}
