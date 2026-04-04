import type { Provider, ProviderConfig, UsageResult } from '../shared/types';

/**
 * MiniMax Provider (stub)
 * TODO: 接入 MiniMax 真实 API
 */
export class MiniMaxProvider implements Provider {
  name = 'MiniMax';

  async fetchUsage(config: ProviderConfig): Promise<UsageResult> {
    // 暂时返回模拟数据，等待 API 接入
    return {
      used: 460000,
      total: 500000,
      expiresAt: '2026-04-30T00:00:00Z',
      details: {}
    };
  }
}
