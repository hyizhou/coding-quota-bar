/**
 * Renderer 进程共享类型定义
 */
import type { TrayDisplayRule, TrayColors, WindowPinMode } from '../../shared/types'

export type { WindowPinMode }

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
  periodHours?: number // 周期长度（小时），用于估算爆仓时间。可选，不传则不算
  color: 'green' | 'yellow' | 'red'
  limitType?: string   // 限制类型标识，如 "tokens"、"mcp"
  hideBar?: boolean    // 为 true 时不显示进度条，仅显示文本
  displayUnit?: 'percent' | 'count' // 显示单位：百分比或次数
  currency?: string    // ISO 币种代码
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

export interface ModelCostRecord {
  date: string
  model: string
  cost: number
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
  currency?: string
  authMode?: 'apikey' | 'weblogin'  // 认证模式；DeepSeek 等多模式 provider 用
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
  modelCostHistory30d: ModelCostRecord[]
  performanceHistory7d: PerformanceRecord[]
  performanceHistory15d: PerformanceRecord[]
  performanceHistory30d: PerformanceRecord[]
  serviceStatus?: DeepSeekServiceComponent[]
  balance?: { total: string; gift: string; cash: string; frozen: string; currency: string }
  limitReached?: boolean
  codexOrgName?: string
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
  hasWebToken?: boolean
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

export type UpdatePhase = 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'noUpdate' | 'error'

export interface UpdateStatus {
  phase: UpdatePhase
  version?: string
  progress?: number
}

export interface AppConfig {
  refreshInterval: number
  providers: Record<string, ProviderTypeConfig>
  display: {
    colorThresholds: {
      green: number
      yellow: number
      colors?: TrayColors
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
  updateStatus?: UpdateStatus
  popupPosition?: { x: number; y: number }
  popupSize?: { width: number; height: number }
  rememberPopupPosition?: boolean
}

export type ApiFormat = 'openai' | 'anthropic'

export interface ConcurrencyTestConfig {
  providerKey: string
  model: string
  concurrency: number
  apiFormat: ApiFormat
}

export interface RequestMetrics {
  success: boolean
  ttftMs: number
  totalMs: number
  tokensPerSec: number
  tokenCount: number
  error?: string
}

export interface ConcurrencyTestResult {
  id: string
  providerKey: string
  model: string
  concurrency: number
  successCount: number
  failCount: number
  totalTimeMs: number
  timestamp: string
  errors: string[]
  avgTtftMs: number
  avgTokensPerSec: number
  minTtftMs: number
  maxTtftMs: number
  avgTotalMs: number
  requestDetails?: RequestMetrics[]
}

export interface ConcurrencyTestProgress {
  index: number
  total: number
  success: boolean
  ttftMs: number
  totalMs: number
  tokenCount: number
  tokensPerSec: number
  error?: string
}

export interface ConcurrencyTestStreamInfo {
  index: number
  text: string
}

export interface ConcurrencyTestFirstContentInfo {
  index: number
  total: number
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
  checkForUpdate: () => Promise<void>
  downloadUpdate: () => Promise<void>
  onUpdateStatusChanged: (callback: (status: UpdateStatus) => void) => () => void
  quitAndInstall: () => Promise<void>
  onTriggerCheckUpdate: (callback: () => void) => void
  offTriggerCheckUpdate: (callback: () => void) => void
  openExternal: (url: string) => Promise<void>
  showPopup: () => void
  setWindowPinned: (mode: WindowPinMode) => void
  onWindowPinnedState: (callback: (mode: WindowPinMode) => void) => void
  getAppVersion: () => Promise<string>
  concurrencyTestStart: (config: ConcurrencyTestConfig) => Promise<ConcurrencyTestResult>
  concurrencyTestGetHistory: (providerKey: string) => Promise<ConcurrencyTestResult[]>
  concurrencyTestDelete: (providerKey: string, id: string) => Promise<void>
  onConcurrencyTestProgress: (callback: (progress: ConcurrencyTestProgress) => void) => void
  offConcurrencyTestProgress: (callback: (progress: ConcurrencyTestProgress) => void) => void
  onConcurrencyTestStream: (callback: (info: ConcurrencyTestStreamInfo) => void) => void
  offConcurrencyTestStream: (callback: (info: ConcurrencyTestStreamInfo) => void) => void
  onConcurrencyTestFirstContent: (callback: (info: ConcurrencyTestFirstContentInfo) => void) => void
  offConcurrencyTestFirstContent: (callback: (info: ConcurrencyTestFirstContentInfo) => void) => void
  deepseekWebLogin: (accountId: string) => Promise<{ success: boolean; error?: string }>
  deepseekWebLogout: (accountId: string) => Promise<void>
  onDeepseekWebLoginSuccess: (callback: (accountId: string) => void) => void
  deepseekFetchMonthUsage: (accountId: string, year: number, month: number) => Promise<{ tokens: ModelTokenRecord[]; costs: ModelCostRecord[] }>
  // 诊断 / 日志
  testProviderConnection: (params: {
    providerKey: string
    accountId?: string
    apiKey?: string
    authMode?: 'apikey' | 'weblogin'
    webToken?: string
    webUserAgent?: string
  }) => Promise<{ ok: boolean; error?: string; latencyMs: number; sample?: { used: number; total: number; level: string } }>
  exportConfig: (options?: { sanitize?: boolean }) => Promise<{ ok: boolean; path?: string; error?: string }>
  importConfig: () => Promise<{ ok: boolean; canceled?: boolean; config?: unknown; error?: string; isSanitized?: boolean }>
  confirmImportConfig: (data: unknown) => Promise<{ ok: boolean; error?: string }>
  getConfigPath: () => Promise<string>
  reloadConfig: () => Promise<{ ok: boolean; error?: string }>
  openConfigFolder: () => Promise<{ ok: boolean; error?: string }>
  reportRendererError: (payload: { message: string; stack?: string; source?: string }) => void
  getRendererLog: () => Promise<{ path: string; tail: string[] }>
  openRendererLog: () => Promise<{ ok: boolean; error?: string }>
  mimoWebLogin: (accountId: string) => Promise<{ success: boolean; error?: string }>
  mimoWebLogout: (accountId: string) => Promise<void>
  onMimoWebLoginSuccess: (callback: (accountId: string) => void) => void
  mimoFetchMonthUsage: (accountId: string, year: number, month: number) => Promise<ModelTokenRecord[]>
  showFeedback: () => void
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
