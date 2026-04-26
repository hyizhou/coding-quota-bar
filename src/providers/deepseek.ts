import type { Provider, ProviderConfig, QuotaItem, UsageResult, DeepSeekServiceComponent, DayStatus } from '../shared/types';
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

interface StatusPageComponent {
  id: string;
  name: string;
  status: string;
}

interface StatusPageIncident {
  started_at: string;
  resolved_at?: string | null;
  impact: string;
  components: StatusPageComponent[];
}

interface IncidentsResponse {
  incidents: StatusPageIncident[];
}

interface StatusPageSummary {
  components: StatusPageComponent[];
  scheduled_maintenances: Array<{
    scheduled_for: string;
    scheduled_until: string;
    components: StatusPageComponent[];
  }>;
}

const STATUS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
let statusCache: { data: DeepSeekServiceComponent[]; ts: number } | null = null;

const STATUS_DAYS = 90;

const TOKEN_EXPIRED = 'TOKEN_EXPIRED';

// 内部 API 响应类型
interface UserSummaryBizData {
  current_token: number;
  monthly_usage: string;
  total_usage: number;
  normal_wallets: Array<{ currency: string; balance: string; token_estimation: string }>;
  bonus_wallets: Array<{ currency: string; balance: string; token_estimation: string }>;
  total_available_token_estimation: string;
  monthly_costs: Array<{ currency: string; amount: string }>;
  monthly_token_usage: string;
}

interface InternalApiData<T> {
  code: number;
  msg?: string;
  data?: { biz_code: number; biz_msg: string; biz_data: T };
}

interface UsageAmountDayEntry {
  date: string;
  data: Array<{
    model: string;
    usage: Array<{ type: string; amount: string }>;
  }>;
}

interface UsageCostDayEntry {
  date: string;
  data: Array<{
    model: string;
    usage: Array<{ type: string; amount: string }>;
  }>;
}

export async function fetchServiceStatus(httpClient?: HttpClientWithRetry): Promise<DeepSeekServiceComponent[]> {
  if (statusCache && Date.now() - statusCache.ts < STATUS_CACHE_TTL) {
    return statusCache.data;
  }

  try {
    const client = httpClient || new HttpClientWithRetry(3, 1000);
    const [summaryResp, incidentsResp] = await Promise.all([
      client.getJson<StatusPageSummary>('https://status.deepseek.com/api/v2/summary.json', {}),
      client.getJson<IncidentsResponse>('https://status.deepseek.com/api/v2/incidents.json', {}),
    ]);

    const components = summaryResp.components || [];
    const incidents = incidentsResp.incidents || [];
    const maintenances = summaryResp.scheduled_maintenances || [];

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const cutoff = new Date(today);
    cutoff.setDate(cutoff.getDate() - STATUS_DAYS);

    // Filter incidents to 90-day window
    const relevantIncidents = incidents.filter(inc => {
      const incStart = new Date(inc.started_at);
      return incStart >= cutoff;
    });

    const result: DeepSeekServiceComponent[] = components.map(comp => {
      const days: DayStatus[] = [];
      let downMinutes = 0;
      const totalMinutes = STATUS_DAYS * 24 * 60;

      for (let i = STATUS_DAYS - 1; i >= 0; i--) {
        const dayStart = new Date(today);
        dayStart.setDate(dayStart.getDate() - i);
        const dayEnd = new Date(dayStart);
        dayEnd.setDate(dayEnd.getDate() + 1);

        let dayStatus: DayStatus = 'operational';

        for (const inc of relevantIncidents) {
          const affects = inc.components.some(c => c.id === comp.id);
          if (!affects) continue;

          const incStart = new Date(inc.started_at);
          const incEnd = inc.resolved_at ? new Date(inc.resolved_at) : new Date();
          // Check overlap with this day
          const overlapStart = incStart > dayStart ? incStart : dayStart;
          const overlapEnd = incEnd < dayEnd ? incEnd : dayEnd;
          if (overlapStart >= overlapEnd) continue;

          const overlapMinutes = (overlapEnd.getTime() - overlapStart.getTime()) / 60000;
          downMinutes += overlapMinutes;

          if (inc.impact === 'critical' || inc.impact === 'major') {
            dayStatus = 'outage';
            break;
          } else if (dayStatus === 'operational') {
            dayStatus = 'degraded';
          }
        }

        // Check maintenances
        if (dayStatus === 'operational') {
          for (const m of maintenances) {
            const mStart = new Date(m.scheduled_for);
            const mEnd = new Date(m.scheduled_until);
            if (mStart < dayEnd && mEnd > dayStart) {
              if (m.components.some(c => c.id === comp.id)) {
                dayStatus = 'maintenance';
                break;
              }
            }
          }
        }

        days.push(dayStatus);
      }

      const uptimePercent = Math.max(0, ((totalMinutes - downMinutes) / totalMinutes) * 100);

      return {
        id: comp.id,
        name: comp.name,
        status: comp.status as DeepSeekServiceComponent['status'],
        days,
        uptime: Math.round(uptimePercent * 100) / 100,
      };
    });

    statusCache = { data: result, ts: Date.now() };
    return result;
  } catch (e) {
    console.warn('[DeepSeek] Failed to fetch service status:', e);
    return statusCache?.data ?? [];
  }
}

export class DeepSeekProvider implements Provider {
  name = 'DeepSeek';

  private httpClient = new HttpClientWithRetry(3, 1000);

  async fetchUsage(config: ProviderConfig): Promise<UsageResult> {
    const mode = config.authMode || 'apikey';
    try {
      if (mode === 'weblogin') {
        return await this.fetchUsageWebLogin(config);
      }
      return await this.fetchUsageApiKey(config);
    } catch (error) {
      if (error instanceof Error && error.message === TOKEN_EXPIRED) {
        return {
          used: 0,
          total: 0,
          expiresAt: '',
          error: TOKEN_EXPIRED,
          details: { quotas: [] },
        };
      }
      throw error;
    }
  }

  private async fetchUsageApiKey(config: ProviderConfig): Promise<UsageResult> {
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

    const serviceStatus = await fetchServiceStatus(this.httpClient);

    return {
      used: 0,
      total: totalBalance,
      expiresAt: '',
      details: { quotas, serviceStatus },
    };
  }

  private async fetchUsageWebLogin(config: ProviderConfig): Promise<UsageResult> {
    const token = config.webToken?.trim();
    if (!token) {
      throw new Error('[DeepSeek] Web token is required for weblogin mode');
    }

    const baseUrl = 'https://platform.deepseek.com';
    const userAgent = config.webUserAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36';
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${token}`,
      'User-Agent': userAgent,
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'Referer': 'https://platform.deepseek.com/usage',
      'Origin': 'https://platform.deepseek.com',
    };

    const checkExpired = (code: number | undefined) => {
      if (code === 40002) throw new Error(TOKEN_EXPIRED);
    };

    // 1. Fetch user summary
    const summaryResp = await this.httpClient.getJson<InternalApiData<UserSummaryBizData>>(
      `${baseUrl}/api/v0/users/get_user_summary`, headers
    );
    checkExpired(summaryResp.code);
    const summary = summaryResp.data?.biz_data;

    // 2. Fetch current month usage amount and cost concurrently
    const now = new Date();
    const month = now.getUTCMonth() + 1;
    const year = now.getUTCFullYear();

    let amountData: { total: UsageAmountDayEntry[]; days: UsageAmountDayEntry[] } | undefined;
    let costData: { total: UsageCostDayEntry[]; days: UsageCostDayEntry[] } | undefined;

    try {
      const [amountResp, costResp] = await Promise.all([
        this.httpClient.getJson<InternalApiData<{ total: UsageAmountDayEntry[]; days: UsageAmountDayEntry[] }>>(
          `${baseUrl}/api/v0/usage/amount?month=${month}&year=${year}`, headers
        ),
        this.httpClient.getJson<InternalApiData<{ total: UsageCostDayEntry[]; days: UsageCostDayEntry[] }>>(
          `${baseUrl}/api/v0/usage/cost?month=${month}&year=${year}`, headers
        ),
      ]);
      checkExpired(amountResp.code);
      checkExpired(costResp.code);
      amountData = amountResp.data?.biz_data;
      costData = costResp.data?.biz_data?.[0]; // cost returns an array with one element
    } catch (e) {
      if (e instanceof Error && e.message === TOKEN_EXPIRED) throw e;
      console.warn('[DeepSeek] Failed to fetch usage amount/cost:', e);
    }

    // 3. Fetch previous month for 30-day history
    const prevMonth = month === 1 ? 12 : month - 1;
    const prevYear = month === 1 ? year - 1 : year;
    let prevDays: UsageAmountDayEntry[] = [];

    try {
      const prevResp = await this.httpClient.getJson<InternalApiData<{ total: UsageAmountDayEntry[]; days: UsageAmountDayEntry[] }>>(
        `${baseUrl}/api/v0/usage/amount?month=${prevMonth}&year=${prevYear}`, headers
      );
      checkExpired(prevResp.code);
      prevDays = prevResp.data?.biz_data?.days ?? [];
    } catch (e) {
      if (e instanceof Error && e.message === TOKEN_EXPIRED) throw e;
      console.warn('[DeepSeek] Failed to fetch previous month data:', e);
    }

    // 4. Build quotas from summary
    const quotas: QuotaItem[] = [];
    const totalBalance = summary ? parseFloat(summary.normal_wallets?.[0]?.balance || '0') : 0;
    const monthlyCost = summary ? parseFloat(summary.monthly_costs?.[0]?.amount || '0') : 0;
    const monthlyTokens = summary ? parseInt(summary.monthly_usage || '0', 10) : 0;

    quotas.push({
      label: 'quota.deepseekTotalBalance',
      used: 0,
      total: totalBalance,
      usageRate: 0,
      resetAt: '',
      hideBar: true,
      labelParams: { amount: totalBalance.toFixed(2) },
    });

    if (monthlyCost > 0) {
      quotas.push({
        label: 'quota.deepseekMonthlyCost',
        used: 0,
        total: monthlyCost,
        usageRate: 0,
        resetAt: '',
        hideBar: true,
        labelParams: { amount: monthlyCost.toFixed(2) },
      });
    }

    if (monthlyTokens > 0) {
      quotas.push({
        label: 'quota.deepseekMonthlyUsage',
        used: monthlyTokens,
        total: monthlyTokens,
        usageRate: 100,
        resetAt: '',
        hideBar: true,
        labelParams: { tokens: monthlyTokens.toLocaleString() },
      });
    }

    // 5. Build usage history from daily data
    const currentDays = amountData?.days ?? [];
    const allDays = [...prevDays, ...currentDays];

    // UTC 今天日期（DeepSeek 所有日期按 UTC 显示）
    const todayStr = `${year}-${String(month).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;
    const todayDate = new Date(todayStr + 'T00:00:00Z');

    const buildHistory = (days: UsageAmountDayEntry[], rangeDays: number): import('../shared/types').UsageRecord[] => {
      const records: import('../shared/types').UsageRecord[] = [];
      const cutoff = new Date(todayDate);
      cutoff.setUTCDate(cutoff.getUTCDate() - rangeDays + 1);

      for (const day of days) {
        const d = new Date(day.date + 'T00:00:00Z');
        if (d < cutoff) continue;
        let total = 0;
        for (const model of day.data) {
          for (const u of model.usage) {
            if (u.type === 'RESPONSE_TOKEN') {
              total += parseInt(u.amount, 10);
            }
          }
        }
        records.push({ date: day.date, used: total });
      }
      return records;
    };

    const history1d = buildHistory(currentDays, 1);
    const history7d = buildHistory(allDays, 7);
    const history30d = buildHistory(allDays, 30);

    // 6. Build model token history
    const buildModelHistory = (days: UsageAmountDayEntry[], rangeDays: number): import('../shared/types').ModelTokenRecord[] => {
      const records: import('../shared/types').ModelTokenRecord[] = [];
      const cutoff = new Date(todayDate);
      cutoff.setUTCDate(cutoff.getUTCDate() - rangeDays + 1);

      for (const day of days) {
        const d = new Date(day.date + 'T00:00:00Z');
        if (d < cutoff) continue;
        for (const model of day.data) {
          let total = 0;
          for (const u of model.usage) {
            if (u.type !== 'REQUEST') {
              total += parseInt(u.amount, 10);
            }
          }
          if (total > 0) {
            records.push({ date: day.date, model: model.model, used: total });
          }
        }
      }
      return records;
    };

    const modelHistory1d = buildModelHistory(allDays, 1);
    const modelHistory7d = buildModelHistory(allDays, 7);
    const modelHistory30d = buildModelHistory(allDays, 30);

    // 7. Calculate totals
    const sumUsed = (records: import('../shared/types').UsageRecord[]) =>
      records.reduce((sum, r) => sum + r.used, 0);

    const serviceStatus = await fetchServiceStatus(this.httpClient);

    return {
      used: 0,
      total: totalBalance,
      expiresAt: '',
      details: {
        quotas,
        history1d,
        history7d,
        history30d,
        totalTokens1d: sumUsed(history1d),
        totalTokens7d: sumUsed(history7d),
        totalTokens30d: sumUsed(history30d),
        estimatedCost1d: 0,
        estimatedCost7d: 0,
        estimatedCost30d: monthlyCost,
        modelHistory1d,
        modelHistory7d,
        modelHistory30d,
        serviceStatus,
      },
    };
  }
}
