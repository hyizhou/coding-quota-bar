import type { Provider, ProviderConfig, QuotaItem, UsageResult } from '../shared/types';
import { HttpClientWithRetry } from '../main/http';

interface BalanceInfo {
  currency: string;
  total_balance: string;
  granted_balance: string;
  topped_up_balance: string;
}

interface BalanceResponse {
  is_available: boolean;
  balance_infos: BalanceInfo[];
}

export class DeepSeekProvider implements Provider {
  name = 'DeepSeek';

  private httpClient = new HttpClientWithRetry(3, 1000);

  async fetchUsage(config: ProviderConfig): Promise<UsageResult> {
    const apiKey = config.apiKey?.trim();
    if (!apiKey) {
      throw new Error('[DeepSeek] API Key is required');
    }

    const baseUrl = (config._baseUrl as string) || 'https://api.deepseek.com';
    const url = `${baseUrl}/user/balance`;

    const resp = await this.httpClient.getJson<BalanceResponse>(url, {
      'Authorization': `Bearer ${apiKey}`,
    });

    if (!resp.is_available) {
      throw new Error('[DeepSeek] Account is not available');
    }

    const info = resp.balance_infos?.[0];
    if (!info) {
      throw new Error('[DeepSeek] No balance data returned');
    }

    const totalBalance = parseFloat(info.total_balance) || 0;
    const grantedBalance = parseFloat(info.granted_balance) || 0;
    const toppedUpBalance = parseFloat(info.topped_up_balance) || 0;

    const quotas: QuotaItem[] = [];

    quotas.push({
      label: 'quota.deepseekTotalBalance',
      used: 0,
      total: totalBalance,
      usageRate: 0,
      resetAt: '',
      hideBar: true,
      labelParams: { amount: totalBalance.toFixed(2) },
    });

    if (grantedBalance > 0) {
      quotas.push({
        label: 'quota.deepseekGranted',
        used: 0,
        total: grantedBalance,
        usageRate: 0,
        resetAt: '',
        hideBar: true,
        labelParams: { amount: grantedBalance.toFixed(2) },
      });
    }

    if (toppedUpBalance > 0) {
      quotas.push({
        label: 'quota.deepseekToppedUp',
        used: 0,
        total: toppedUpBalance,
        usageRate: 0,
        resetAt: '',
        hideBar: true,
        labelParams: { amount: toppedUpBalance.toFixed(2) },
      });
    }

    return {
      used: 0,
      total: totalBalance,
      expiresAt: '',
      details: { quotas },
    };
  }
}
