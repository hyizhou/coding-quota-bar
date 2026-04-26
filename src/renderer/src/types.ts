/**
 * Renderer 进程共享类型定义
 */

export interface SubscriptionInfo {
  plan: string
  status: string
  currentRenewTime: string
  nextRenewTime: string
  autoRenew: boolean
  actualPrice: number
  renewPrice: number
  billingCycle: string
}

export interface QuotaItem {
  label: string
  labelParams?: Record<string, string | number>
  used: number
  total: number
  usageRate: number    // 使用率 0-100
  resetAt: string      // 重置时间
  startAt?: string     // 周期开始时间
  color: 'green' | 'yellow' | 'red'
  limitType?: string   // 限制类型标识，如 "tokens"、"mcp"
  hideBar?: boolean    // 为 true 时不显示进度条，仅显示文本
}

export interface UsageRecord {
  date: string    // 'YYYY-MM-DD' (日级别) 或 'YYYY-MM-DDTHH' (小时级别)
  used: number
}

export interface McpUsageRecord {
  date: string
  search: number
  webRead: number
  zread: number
}

export interface ModelTokenRecord {
  date: string
  model: string
  used: number
  requests?: number
  cacheHitTokens?: number
  cacheMissTokens?: number
  responseTokens?: number
}

export interface PerformanceRecord {
  date: string
  liteDecodeSpeed: number
  proMaxDecodeSpeed: number
  liteSuccessRate: number
  proMaxSuccessRate: number
}

/**
 * 单个账户的用量数据
 */
export interface AccountUsageData {
  id: string
  label?: string
  level?: string
  subscription?: SubscriptionInfo
  error?: string
  quotas: QuotaItem[]
  history1d: UsageRecord[]
  history7d: UsageRecord[]
  history30d: UsageRecord[]
  totalTokens1d: number
  totalTokens7d: number
  totalTokens30d: number
  estimatedCost1d: number
  estimatedCost7d: number
  estimatedCost30d: number
  modelRates?: Record<string, number>
  mcpHistory1d: McpUsageRecord[]
  mcpHistory7d: McpUsageRecord[]
  mcpHistory30d: McpUsageRecord[]
  modelHistory1d: ModelTokenRecord[]
  modelHistory7d: ModelTokenRecord[]
  modelHistory30d: ModelTokenRecord[]
  performanceHistory7d: PerformanceRecord[]
  performanceHistory15d: PerformanceRecord[]
  performanceHistory30d: PerformanceRecord[]
  serviceStatus?: DeepSeekServiceComponent[]
}

/**
 * Provider 用量数据（含多账户）
 */
export interface ProviderUsageData {
  key: string
  name: string
  websiteUrl?: string
  accounts: AccountUsageData[]
}

export interface UsageState {
  providers: ProviderUsageData[]
  lastUpdate: string
  overallPercent: number
}

export interface AccountConfig {
  id: string
  enabled: boolean
  apiKey: string
  label: string
  budget?: number
  authMode?: 'apikey' | 'weblogin'
  webToken?: string
  webUserAgent?: string
}

export interface ProviderTypeConfig {
  accounts: AccountConfig[]
}

export type ComponentStatus = 'operational' | 'degraded_performance' | 'partial_outage' | 'major_outage'
export type DayStatus = 'operational' | 'degraded' | 'outage' | 'maintenance'

export interface DeepSeekServiceComponent {
  id: string
  name: string
  status: ComponentStatus
  days: DayStatus[]
  uptime: number
}

export interface UpdateInfo {
  version: string
  downloaded: boolean
}

export interface AppConfig {
  refreshInterval: number
  providers: Record<string, ProviderTypeConfig>
  display: {
    colorThresholds: {
      green: number
      yellow: number
    }
  }
  autoStart: boolean
  popupTrigger?: 'hover' | 'click'
  memorySavingMode?: boolean
  showEstimatedCost?: boolean
  language?: string
  theme?: 'light' | 'dark' | 'auto'
  trayDisplayRule?: TrayDisplayRule
  autoCheckUpdate?: boolean
  autoCheckUpdateInterval?: number
  lastAutoCheckTime?: string | null
  updateInfo?: UpdateInfo | null
}

export interface ElectronAPI {
  getDevMode: () => Promise<boolean>
  getUsageData: () => Promise<UsageState | null>
  refreshUsage: () => Promise<UsageState | null>
  getConfig: () => Promise<AppConfig | null>
  updateConfig: (updates: unknown) => Promise<AppConfig | null>
  getAvailableProviders: () => Promise<string[]>
  onShowSettings: (callback: (options?: { checkUpdate?: boolean }) => void) => void
  onUsageDataUpdated: (callback: (data: UsageState) => void) => void
  notifyHoverState: (hovering: boolean) => void
  checkForUpdate: () => Promise<{ available: boolean; version?: string }>
  downloadUpdate: () => Promise<boolean>
  onUpdateDownloadProgress: (callback: (progress: { percent: number; transferred: number; total: number }) => void) => void
  onUpdateDownloaded: (callback: () => void) => void
  quitAndInstall: () => Promise<void>
  onTriggerCheckUpdate: (callback: () => void) => void
  offTriggerCheckUpdate: (callback: () => void) => void
  openExternal: (url: string) => Promise<void>
  showPopup: () => void
  setWindowPinned: (pinned: boolean) => void
  onWindowPinnedState: (callback: (pinned: boolean) => void) => void
  getAppVersion: () => Promise<string>
  onUpdateAvailableAuto: (callback: (info: { version: string }) => void) => void
  deepseekWebLogin: (accountId: string) => Promise<{ success: boolean; error?: string }>
  deepseekWebLogout: (accountId: string) => Promise<void>
  onDeepseekWebLoginSuccess: (callback: (accountId: string) => void) => void
  deepseekFetchMonthUsage: (accountId: string, year: number, month: number) => Promise<ModelTokenRecord[]>
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
