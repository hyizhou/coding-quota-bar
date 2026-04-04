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
 * 生成近30天的伪造历史数据
 */
function generateMockHistory(): { date: string; used: number }[] {
  const records: { date: string; used: number }[] = [];
  const now = new Date();
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 86400000);
    const dateStr = d.toISOString().slice(0, 10);
    // 模拟每天 1万~8万的用量
    const used = Math.round(10000 + Math.random() * 70000);
    records.push({ date: dateStr, used });
  }
  return records;
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

      // TODO: 从 API 获取真实的 quotas 和 usageHistory
      // 目前使用伪造数据
      return {
        used,
        total,
        expiresAt,
        details: {
          percentage: tokenLimit.percentage,
          remaining,
          remainingPercent: Math.round((remaining / total) * 1000) / 10,
          quotas: [
            {
              label: '5小时窗口',
              used: 250000,
              total: 1000000,
              usageRate: 25,
              resetAt: new Date(Date.now() + 5 * 3600000).toISOString()
            },
            {
              label: 'MCP额度',
              used: 12,
              total: 50,
              usageRate: 24,
              resetAt: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1).toISOString()
            }
          ],
          usageHistory: generateMockHistory()
        }
      };
    } catch (error) {
      console.error('[Zhipu] Failed to fetch usage:', error);
      throw error;
    }
  }
}
