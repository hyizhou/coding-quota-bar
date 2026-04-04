/**
 * Provider 配置接口
 */
export interface ProviderConfig {
  enabled: boolean;
  apiKey: string;
  [key: string]: unknown;
}

/**
 * 单个额度项（如 5小时窗口、MCP额度）
 */
export interface QuotaItem {
  label: string;         // 额度名称，如 "5小时窗口"、"MCP额度"
  used: number;          // 已用量
  total: number;         // 总量
  usageRate: number;     // 使用率 0-100
  resetAt: string;       // 重置时间 ISO 8601
}

/**
 * 历史统计记录
 */
export interface UsageRecord {
  date: string;          // 日期 '2026-04-04'
  used: number;          // 当日用量
}

/**
 * 用量查询结果
 */
export interface UsageResult {
  used: number;          // 已用 token 数（兼容旧逻辑）
  total: number;         // 总量
  expiresAt: string;     // 到期时间 ISO 8601
  details?: {
    quotas?: QuotaItem[];          // 多个额度项
    usageHistory?: UsageRecord[];  // 历史统计
    [key: string]: unknown;
  };
}

/**
 * Provider 插件接口
 */
export interface Provider {
  name: string;
  fetchUsage(config: ProviderConfig): Promise<UsageResult>;
}

/**
 * 应用配置
 */
export interface AppConfig {
  refreshInterval: number;
  providers: Record<string, ProviderConfig>;
  display: {
    colorThresholds: {
      green: number;
      yellow: number;
    };
  };
  autoStart: boolean;
  language?: string;
}

/**
 * 显示颜色
 */
export type DisplayColor = 'green' | 'yellow' | 'red';
