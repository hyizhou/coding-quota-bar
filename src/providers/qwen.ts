import type { Provider, ProviderConfig, UsageResult } from '../shared/types';
import { HttpClient } from '../main/http';
import {
  QWEN_API,
  buildGatewayRequest,
  buildQuotaItems,
  formatSpecCode,
  parseGatewayResponse,
  parseQuotaConfig,
  parseSubscription,
  parseUsageWindows,
  type QwenGatewayResult,
  type QwenQuotaConfig,
} from './qwen-protocol';

/**
 * 千问 / 阿里云百炼 Token Plan 用量查询
 * 接口：百炼控制台 CLI 网关（与官方 bailian-cli `bl usage token-plan` 一致）
 * 鉴权：控制台 access token（网页登录 console-login 回传，存于 webToken，主进程加密）
 * 数据：usage（各窗口已用比例 + 重置时间）、subscription（套餐规格/到期）、
 *      quota-config（各规格 Credits 总额，用于换算绝对用量）
 * 协议细节见 api-docs/qwen/QWEN_TOKEN_PLAN_API.md
 */

const TOKEN_EXPIRED = 'TOKEN_EXPIRED';

// 套餐额度配置为静态表，进程级缓存 6 小时，避免每次刷新多打一次网关
const QUOTA_CONFIG_TTL_MS = 6 * 60 * 60 * 1000;
let quotaConfigCache: { at: number; region: string; value: QwenQuotaConfig } | null = null;

class QwenSessionExpiredError extends Error {}

async function callGateway(region: unknown, api: string, token: string): Promise<Record<string, unknown>> {
  const req = buildGatewayRequest(region, api, token);
  const resp = await HttpClient.request(req.url, { method: 'POST', headers: req.headers, body: req.body });
  if (resp.status === 401 || resp.status === 403) throw new QwenSessionExpiredError();
  if (resp.status >= 400) {
    throw new Error(`[Qwen] HTTP ${resp.status}: ${resp.body.slice(0, 120)}`);
  }
  const result: QwenGatewayResult = parseGatewayResponse(resp.body);
  if (!result.ok) {
    if (result.expired) throw new QwenSessionExpiredError();
    throw new Error(`[Qwen] ${result.error}`);
  }
  return result.data;
}

async function getQuotaConfig(region: unknown, token: string): Promise<QwenQuotaConfig | null> {
  const regionKey = region === 'global' ? 'global' : 'cn';
  if (quotaConfigCache && quotaConfigCache.region === regionKey && Date.now() - quotaConfigCache.at < QUOTA_CONFIG_TTL_MS) {
    return quotaConfigCache.value;
  }
  try {
    const value = parseQuotaConfig(await callGateway(region, QWEN_API.quotaConfig, token));
    quotaConfigCache = { at: Date.now(), region: regionKey, value };
    return value;
  } catch (e) {
    // 额度配置仅用于换算 Credits 绝对量，失败时退化为只展示百分比
    if (e instanceof QwenSessionExpiredError) throw e;
    console.warn('[Qwen] Failed to fetch quota config:', e);
    return null;
  }
}

export class QwenProvider implements Provider {
  name = 'Qwen';

  async fetchUsage(config: ProviderConfig): Promise<UsageResult> {
    const token = config.webToken?.trim();
    if (!token) {
      return { used: 0, total: 0, expiresAt: '', error: TOKEN_EXPIRED, details: { quotas: [] } };
    }
    const region = config.region;

    try {
      const [usageData, subscriptionData, quotaConfig] = await Promise.all([
        callGateway(region, QWEN_API.usage, token),
        // 订阅信息只用于套餐名与到期时间，失败不影响用量展示
        callGateway(region, QWEN_API.subscription, token).catch((e) => {
          if (e instanceof QwenSessionExpiredError) throw e;
          console.warn('[Qwen] Failed to fetch subscription:', e);
          return null;
        }),
        getQuotaConfig(region, token),
      ]);

      const subscription = subscriptionData ? parseSubscription(subscriptionData) : null;
      const windows = parseUsageWindows(usageData);
      const quotas = buildQuotaItems(windows, subscription, quotaConfig);

      if (quotas.length === 0) {
        // hasQuotaData=false：已订阅但尚无消耗时网关不返回窗口
        if (subscription) {
          return {
            used: 0,
            total: 100,
            expiresAt: subscription.endAt,
            level: formatSpecCode(subscription.specCode),
            details: { quotas: [], qwenSubscription: subscription },
          };
        }
        throw new Error('[Qwen] No Token Plan quota found for this account');
      }

      // 托盘取最紧张窗口的使用率
      const tightest = quotas.reduce((a, b) => (b.usageRate > a.usageRate ? b : a));
      return {
        used: tightest.usageRate,
        total: 100,
        expiresAt: subscription?.endAt || tightest.resetAt,
        level: subscription ? formatSpecCode(subscription.specCode) : undefined,
        details: { quotas, ...(subscription ? { qwenSubscription: subscription } : {}) },
      };
    } catch (e) {
      if (e instanceof QwenSessionExpiredError) {
        return { used: 0, total: 0, expiresAt: '', error: TOKEN_EXPIRED, details: { quotas: [] } };
      }
      throw e;
    }
  }
}
