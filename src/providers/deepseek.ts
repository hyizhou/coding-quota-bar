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

async function fetchServiceStatus(httpClient: HttpClientWithRetry): Promise<DeepSeekServiceComponent[]> {
  if (statusCache && Date.now() - statusCache.ts < STATUS_CACHE_TTL) {
    return statusCache.data;
  }

  try {
    const [summaryResp, incidentsResp] = await Promise.all([
      httpClient.getJson<StatusPageSummary>('https://status.deepseek.com/api/v2/summary.json', {}),
      httpClient.getJson<IncidentsResponse>('https://status.deepseek.com/api/v2/incidents.json', {}),
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
}
