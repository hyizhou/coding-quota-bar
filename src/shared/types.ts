/**
 * 单个账户配置
 */
export interface AccountConfig {
  id: string;       // 稳定随机 ID，创建时生成
  enabled: boolean;
  apiKey: string;
  label: string;    // 用户自定义备注，如 "工作号"
  budget?: number;  // 用户自定义总额度（元），用于纯余额服务商
}

/**
 * Provider 类型配置（支持多账户）
 */
export interface ProviderTypeConfig {
  accounts: AccountConfig[];
}

/**
 * Provider 配置接口（向后兼容，同时供 Provider 实例使用）
 */
export interface ProviderConfig {
  enabled: boolean;
  apiKey: string;
  _baseUrl?: string;
  [key: string]: unknown;
}

/**
 * 单个额度项（如 5小时窗口、MCP额度）
 */
export interface QuotaItem {
  label: string;         // i18n key，如 "quota.tokensLimit"
  labelParams?: Record<string, string | number>;  // 翻译参数
  used: number;          // 已用量
  total: number;         // 总量
  usageRate: number;     // 使用率 0-100
  resetAt: string;       // 重置时间 ISO 8601
  startAt?: string;      // 周期开始时间 ISO 8601
  limitType?: string;    // 限制类型标识，如 "tokens"、"mcp"
  hideBar?: boolean;     // 为 true 时不显示进度条，仅显示文本
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
 * 模型性能历史记录（单日数据点）
 */
export interface PerformanceRecord {
  date: string;              // 'YYYY-MM-DD'
  liteDecodeSpeed: number;   // tokens/s
  proMaxDecodeSpeed: number; // tokens/s
  liteSuccessRate: number;   // 0~1
  proMaxSuccessRate: number; // 0~1
}

/**
 * 订阅信息
 */
export interface SubscriptionInfo {
  plan: string;             // 套餐标识，如 "新 pro"、"老 lite"
  status: string;           // 订阅状态，如 "VALID"
  currentRenewTime: string;  // 当前订阅日期
  nextRenewTime: string;    // 下次续费日期
  autoRenew: boolean;       // 是否自动续费
  actualPrice: number;      // 实付价格（元）
  renewPrice: number;       // 续费价格（元）
  billingCycle: string;     // 计费周期，如 "annually"
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
    quotas?: QuotaItem[];                // 多个额度项
    usageHistory?: UsageRecord[];        // 历史统计
    subscription?: SubscriptionInfo;     // 订阅信息
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
 * 更新检查结果（持久化到配置文件）
 */
export interface UpdateInfo {
  version: string;
  downloaded: boolean;
}

/**
 * 应用配置
 */
export type TrayDisplayRule = 'lowest' | 'highest' | string; // string = compound key "providerType:accountId"

export interface AppConfig {
  refreshInterval: number;
  providers: Record<string, ProviderTypeConfig>;
  display: {
    colorThresholds: {
      green: number;
      yellow: number;
    };
  };
  autoStart: boolean;
  popupTrigger?: 'hover' | 'click';
  memorySavingMode?: boolean;
  showEstimatedCost?: boolean;
  language?: string;
  theme?: 'light' | 'dark' | 'auto';
  trayDisplayRule?: TrayDisplayRule;
  updateInfo?: UpdateInfo | null;
}

/**
 * 显示颜色
 */
export type DisplayColor = 'green' | 'yellow' | 'red';

/**
 * DeepSeek 服务组件当前状态
 */
export type ComponentStatus = 'operational' | 'degraded_performance' | 'partial_outage' | 'major_outage';
export type DayStatus = 'operational' | 'degraded' | 'outage' | 'maintenance';

export interface DeepSeekServiceComponent {
  id: string;
  name: string;
  status: ComponentStatus;
  days: DayStatus[];
  uptime: number;  // 90-day uptime percentage, e.g. 99.95
}

/**
 * 生成账户 ID（8 位随机 hex）
 */
export function generateAccountId(): string {
  return Math.random().toString(16).slice(2, 10);
}
