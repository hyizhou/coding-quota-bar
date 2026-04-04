import type { Provider, ProviderConfig, UsageResult } from '../shared/types';

/**
 * Kimi Provider (stub)
 * TODO: 接入 Kimi 真实 API
 */
export class KimiProvider implements Provider {
  name = 'Kimi';

  async fetchUsage(config: ProviderConfig): Promise<UsageResult> {
    // 暂时返回模拟数据，等待 API 接入
    return {
      used: 120000,
      total: 150000,
      expiresAt: '2026-04-15T00:00:00Z',
      details: {}
    };
  }
}
