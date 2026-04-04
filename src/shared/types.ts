/**
 * Provider 配置接口
 */
export interface ProviderConfig {
  enabled: boolean;
  apiKey: string;
  [key: string]: unknown;
}

/**
 * 用量查询结果
 */
export interface UsageResult {
  used: number;          // 已用 token 数
  total: number;         // 总量
  expiresAt: string;     // 到期时间 ISO 8601
  details?: Record<string, unknown>; // 平台扩展数据
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
