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
  date: string;          // 'YYYY-MM-DD' (日级别) 或 'YYYY-MM-DDTHH' (小时级别)
  used: number;          // 用量
}

/**
 * MCP 工具调用历史记录
 */
export interface McpUsageRecord {
  date: string;          // 'YYYY-MM-DD' (日级别) 或 'YYYY-MM-DDTHH' (小时级别)
  search: number;        // 联网搜索次数
  webRead: number;       // 网页阅读次数
  zread: number;         // ZRead 次数
}

/**
 * 分模型 Token 使用历史记录
 */
export interface ModelTokenRecord {
  date: string;
  model: string;
  used: number;
}

/**
 * 用量查询结果
 */
export interface UsageResult {
  used: number;          // 已用 token 数（兼容旧逻辑）
  total: number;         // 总量
  expiresAt: string;     // 到期时间 ISO 8601
  level?: string;        // 套餐等级，如 "lite"、"pro"、"max"
  error?: string;        // 错误信息（如 key 无效、网络异常等）
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
  theme?: 'light' | 'dark' | 'auto';
}

/**
 * 显示颜色
 */
export type DisplayColor = 'green' | 'yellow' | 'red';
