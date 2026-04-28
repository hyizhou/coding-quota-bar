import type { UsageResult } from '../shared/types';
import pricingConfig from '../providers/zai-pricing.json';

const { models: MODEL_PRICING, tokenRatio: TOKEN_RATIO } = pricingConfig as {
  models: Record<string, { cache: number; input: number; output: number }>;
  tokenRatio: { cache: number; input: number; output: number };
};

function calcMockModelRates(): Record<string, number> {
  const rates: Record<string, number> = {};
  for (const [name, p] of Object.entries(MODEL_PRICING)) {
    rates[name] = Math.round((
      TOKEN_RATIO.cache * p.cache +
      TOKEN_RATIO.input * p.input +
      TOKEN_RATIO.output * p.output
    ) * 100) / 100;
  }
  return rates;
}

function calcMockEstimatedCost(totalTokens: number): number {
  const avgRate = Object.values(MODEL_PRICING)
    .reduce((sum, p) => sum + TOKEN_RATIO.cache * p.cache + TOKEN_RATIO.input * p.input + TOKEN_RATIO.output * p.output, 0)
    / Object.keys(MODEL_PRICING).length;
  return Math.round(totalTokens / 1_000_000 * avgRate * 100) / 100;
}

const HOUR = 3600000;
const DAY = 86400000;

// ── 智谱专用数据生成 ────────────────────────────────

/**
 * 生成小时级用量历史（智谱 1d / 7d）
 */
function generateZhipuHourlyHistory(hours: number): { date: string; used: number }[] {
  const records: { date: string; used: number }[] = [];
  const now = new Date();
  const start = new Date(now.getTime() - hours * HOUR);
  start.setMinutes(0, 0, 0);
  for (let t = start.getTime(); t <= now.getTime(); t += HOUR) {
    records.push({ date: new Date(t).toISOString().slice(0, 13), used: Math.round(10000 + Math.random() * 40000) });
  }
  return records;
}

/**
 * 生成天级用量历史（智谱 30d）
 */
function generateZhipuDailyHistory(days: number): { date: string; used: number }[] {
  const records: { date: string; used: number }[] = [];
  const now = new Date();
  for (let i = days; i >= 0; i--) {
    const d = new Date(now.getTime() - i * DAY);
    records.push({ date: d.toISOString().slice(0, 10), used: Math.round(200000 + Math.random() * 800000) });
  }
  return records;
}

/**
 * 生成小时级 MCP 工具历史（智谱 1d / 7d）
 */
function generateZhipuHourlyMcpHistory(hours: number): { date: string; search: number; webRead: number; zread: number }[] {
  const records: { date: string; search: number; webRead: number; zread: number }[] = [];
  const now = new Date();
  const start = new Date(now.getTime() - hours * HOUR);
  start.setMinutes(0, 0, 0);
  for (let t = start.getTime(); t <= now.getTime(); t += HOUR) {
    records.push({
      date: new Date(t).toISOString().slice(0, 13),
      search: Math.round(Math.random() * 15),
      webRead: Math.round(Math.random() * 8),
      zread: Math.round(Math.random() * 3)
    });
  }
  return records;
}

/**
 * 生成天级 MCP 工具历史（智谱 30d）
 */
function generateZhipuDailyMcpHistory(days: number): { date: string; search: number; webRead: number; zread: number }[] {
  const records: { date: string; search: number; webRead: number; zread: number }[] = [];
  const now = new Date();
  for (let i = days; i >= 0; i--) {
    const d = new Date(now.getTime() - i * DAY);
    records.push({
      date: d.toISOString().slice(0, 10),
      search: Math.round(20 + Math.random() * 80),
      webRead: Math.round(5 + Math.random() * 30),
      zread: Math.round(Math.random() * 10)
    });
  }
  return records;
}

/**
 * 生成分模型用量历史（小时级，智谱 1d / 7d）
 */
function generateZhipuHourlyModelHistory(hours: number): { date: string; model: string; used: number }[] {
  const models = ['GLM-5.1', 'GLM-5-Turbo', 'GLM-4.7'];
  const records: { date: string; model: string; used: number }[] = [];
  const now = new Date();
  const start = new Date(now.getTime() - hours * HOUR);
  start.setMinutes(0, 0, 0);
  for (let t = start.getTime(); t <= now.getTime(); t += HOUR) {
    const dateStr = new Date(t).toISOString().slice(0, 13);
    for (const model of models) {
      if (Math.random() > 0.3) {
        records.push({ date: dateStr, model, used: Math.round(5000 + Math.random() * 20000) });
      }
    }
  }
  return records;
}

/**
 * 生成分模型用量历史（天级，智谱 30d）
 */
function generateZhipuDailyModelHistory(days: number): { date: string; model: string; used: number }[] {
  const models = ['GLM-5.1', 'GLM-5-Turbo', 'GLM-4.7'];
  const records: { date: string; model: string; used: number }[] = [];
  const now = new Date();
  for (let i = days; i >= 0; i--) {
    const dateStr = new Date(now.getTime() - i * DAY).toISOString().slice(0, 10);
    for (const model of models) {
      records.push({ date: dateStr, model, used: Math.round(50000 + Math.random() * 200000) });
    }
  }
  return records;
}

/**
 * 生成系统健康度历史（天级）
 */
function generatePerformanceHistory(days: number): { date: string; liteDecodeSpeed: number; proMaxDecodeSpeed: number; liteSuccessRate: number; proMaxSuccessRate: number }[] {
  const records: { date: string; liteDecodeSpeed: number; proMaxDecodeSpeed: number; liteSuccessRate: number; proMaxSuccessRate: number }[] = [];
  const now = new Date();
  for (let i = days; i >= 0; i--) {
    const d = new Date(now.getTime() - i * DAY);
    records.push({
      date: d.toISOString().slice(0, 10),
      liteDecodeSpeed: Math.round(60 + Math.random() * 40),
      proMaxDecodeSpeed: Math.round(30 + Math.random() * 30),
      liteSuccessRate: +(0.85 + Math.random() * 0.14).toFixed(2),
      proMaxSuccessRate: +(0.8 + Math.random() * 0.18).toFixed(2)
    });
  }
  return records;
}

// ── 入口 ────────────────────────────────────────────

/**
 * 模拟用量数据（DEV=1 QUOTA_MOCK=1 时使用）
 *
 * 每次调用都基于当前时间生成新数据，确保时间字段始终有效。
 * 各 Provider 的 mock 数据与其真实 Provider 返回结构保持一致。
 */
export function generateMockData(): Record<string, UsageResult> {
  const now = Date.now();

  const totalTokens1d = Math.round(500000 + Math.random() * 500000);
  const totalTokens7d = Math.round(3000000 + Math.random() * 3000000);
  const totalTokens30d = Math.round(10000000 + Math.random() * 10000000);

  return {
    zhipu: {
      used: 250000,
      total: 1000000,
      expiresAt: new Date(now + 5 * HOUR).toISOString(),
      level: 'pro',
      details: {
        remainingPercent: 75,
        subscription: {
          plan: '老 Pro',
          status: 'VALID',
          currentRenewTime: '2026-03-03',
          nextRenewTime: '2027-03-03',
          autoRenew: true,
          actualPrice: 2400,
          renewPrice: 2400,
          billingCycle: 'annually'
        },
        quotas: [
          { label: 'quota.mcpUsage', used: 12, total: 50, usageRate: 24, resetAt: new Date(new Date(now).getFullYear(), new Date(now).getMonth() + 1, 1).toISOString(), limitType: 'mcp' },
          { label: 'quota.tokensLimit', labelParams: { n: 5 }, used: 250000, total: 1000000, usageRate: 25, resetAt: new Date(now + 5 * HOUR).toISOString(), limitType: 'tokens' },
          { label: 'quota.tokensLimitDaily', labelParams: { n: 7 }, used: 6000, total: 15000, usageRate: 40, resetAt: new Date(now + 7 * DAY).toISOString(), limitType: 'tokens' }
        ],
        history1d: generateZhipuHourlyHistory(24),
        history7d: generateZhipuHourlyHistory(168),
        history30d: generateZhipuDailyHistory(30),
        totalTokens1d,
        totalTokens7d,
        totalTokens30d,
        estimatedCost1d: calcMockEstimatedCost(totalTokens1d),
        estimatedCost7d: calcMockEstimatedCost(totalTokens7d),
        estimatedCost30d: calcMockEstimatedCost(totalTokens30d),
        modelRates: calcMockModelRates(),
        mcpHistory1d: generateZhipuHourlyMcpHistory(24),
        mcpHistory7d: generateZhipuHourlyMcpHistory(168),
        mcpHistory30d: generateZhipuDailyMcpHistory(30),
        modelHistory1d: generateZhipuHourlyModelHistory(24),
        modelHistory7d: generateZhipuHourlyModelHistory(168),
        modelHistory30d: generateZhipuDailyModelHistory(30),
        performanceHistory7d: generatePerformanceHistory(7),
        performanceHistory15d: generatePerformanceHistory(15),
        performanceHistory30d: generatePerformanceHistory(30)
      }
    },

    minimax: {
      used: 668,
      total: 4500,
      expiresAt: new Date(now + 4 * HOUR).toISOString(),
      details: {
        quotas: [
          {
            label: 'quota.minimaxDaily', used: 668, total: 4500, usageRate: 15,
            resetAt: new Date(now + 4 * HOUR).toISOString(),
            startAt: new Date(now - 0 * HOUR).toISOString(),
            limitType: 'MiniMax-M*',
          },
          {
            label: 'quota.minimaxDaily', used: 352, total: 19000, usageRate: 2,
            resetAt: new Date(now + 12 * HOUR).toISOString(),
            startAt: new Date(now - 12 * HOUR).toISOString(),
            limitType: 'speech-hd',
          },
          {
            label: 'quota.minimaxWeekly', used: 2100, total: 133000, usageRate: 2,
            resetAt: new Date(now + 5 * DAY).toISOString(),
            startAt: new Date(now - 2 * DAY).toISOString(),
            limitType: 'speech-hd',
          },
          {
            label: 'quota.minimaxDaily', used: 1, total: 3, usageRate: 33,
            resetAt: new Date(now + 12 * HOUR).toISOString(),
            startAt: new Date(now - 12 * HOUR).toISOString(),
            limitType: 'MiniMax-Hailuo-2.3-Fast-6s-768p',
          },
          {
            label: 'quota.minimaxWeekly', used: 3, total: 21, usageRate: 14,
            resetAt: new Date(now + 5 * DAY).toISOString(),
            startAt: new Date(now - 2 * DAY).toISOString(),
            limitType: 'MiniMax-Hailuo-2.3-Fast-6s-768p',
          },
          {
            label: 'quota.minimaxDaily', used: 0, total: 3, usageRate: 0,
            resetAt: new Date(now + 12 * HOUR).toISOString(),
            startAt: new Date(now - 12 * HOUR).toISOString(),
            limitType: 'MiniMax-Hailuo-2.3-6s-768p',
          },
          {
            label: 'quota.minimaxWeekly', used: 0, total: 21, usageRate: 0,
            resetAt: new Date(now + 5 * DAY).toISOString(),
            startAt: new Date(now - 2 * DAY).toISOString(),
            limitType: 'MiniMax-Hailuo-2.3-6s-768p',
          },
          {
            label: 'quota.minimaxDaily', used: 2, total: 7, usageRate: 29,
            resetAt: new Date(now + 12 * HOUR).toISOString(),
            startAt: new Date(now - 12 * HOUR).toISOString(),
            limitType: 'music-2.5',
          },
          {
            label: 'quota.minimaxWeekly', used: 8, total: 49, usageRate: 16,
            resetAt: new Date(now + 5 * DAY).toISOString(),
            startAt: new Date(now - 2 * DAY).toISOString(),
            limitType: 'music-2.5',
          },
          {
            label: 'quota.minimaxDaily', used: 12, total: 100, usageRate: 12,
            resetAt: new Date(now + 12 * HOUR).toISOString(),
            startAt: new Date(now - 12 * HOUR).toISOString(),
            limitType: 'music-2.6',
          },
          {
            label: 'quota.minimaxWeekly', used: 45, total: 700, usageRate: 6,
            resetAt: new Date(now + 5 * DAY).toISOString(),
            startAt: new Date(now - 2 * DAY).toISOString(),
            limitType: 'music-2.6',
          },
          {
            label: 'quota.minimaxDaily', used: 0, total: 100, usageRate: 0,
            resetAt: new Date(now + 12 * HOUR).toISOString(),
            startAt: new Date(now - 12 * HOUR).toISOString(),
            limitType: 'music-cover',
          },
          {
            label: 'quota.minimaxWeekly', used: 0, total: 700, usageRate: 0,
            resetAt: new Date(now + 5 * DAY).toISOString(),
            startAt: new Date(now - 2 * DAY).toISOString(),
            limitType: 'music-cover',
          },
          {
            label: 'quota.minimaxDaily', used: 5, total: 100, usageRate: 5,
            resetAt: new Date(now + 12 * HOUR).toISOString(),
            startAt: new Date(now - 12 * HOUR).toISOString(),
            limitType: 'lyrics_generation',
          },
          {
            label: 'quota.minimaxWeekly', used: 30, total: 700, usageRate: 4,
            resetAt: new Date(now + 5 * DAY).toISOString(),
            startAt: new Date(now - 2 * DAY).toISOString(),
            limitType: 'lyrics_generation',
          },
          {
            label: 'quota.minimaxDaily', used: 8, total: 200, usageRate: 4,
            resetAt: new Date(now + 12 * HOUR).toISOString(),
            startAt: new Date(now - 12 * HOUR).toISOString(),
            limitType: 'image-01',
          },
          {
            label: 'quota.minimaxWeekly', used: 35, total: 1400, usageRate: 3,
            resetAt: new Date(now + 5 * DAY).toISOString(),
            startAt: new Date(now - 2 * DAY).toISOString(),
            limitType: 'image-01',
          },
          {
            label: 'quota.minimaxDaily', used: 67, total: 450, usageRate: 15,
            resetAt: new Date(now + 4 * HOUR).toISOString(),
            startAt: new Date(now - 0 * HOUR).toISOString(),
            limitType: 'coding-plan-vlm',
          },
          {
            label: 'quota.minimaxDaily', used: 120, total: 450, usageRate: 27,
            resetAt: new Date(now + 4 * HOUR).toISOString(),
            startAt: new Date(now - 0 * HOUR).toISOString(),
            limitType: 'coding-plan-search',
          },
        ],
      },
    },

    deepseek: {
      used: 0,
      total: 50,
      expiresAt: '',
      details: {
        quotas: [
          { label: 'quota.deepseekTotalBalance', used: 0, total: 50, usageRate: 0, resetAt: '', hideBar: true, labelParams: { amount: '50.00' } },
          { label: 'quota.deepseekGranted', used: 0, total: 30, usageRate: 0, resetAt: '', hideBar: true, labelParams: { amount: '30.00' } },
          { label: 'quota.deepseekToppedUp', used: 0, total: 20, usageRate: 0, resetAt: '', hideBar: true, labelParams: { amount: '20.00' } },
        ],
      },
    },

    kimi: {
      used: 120000,
      total: 150000,
      expiresAt: new Date(now + 7 * DAY).toISOString(),
      details: {
        quotas: [
          { label: '配额', used: 120000, total: 150000, usageRate: 80, resetAt: new Date(now + 7 * DAY).toISOString() }
        ]
      }
    }
  };
}
