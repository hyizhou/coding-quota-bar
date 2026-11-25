/**
 * 设置页服务商配置的类型：渲染层的服务商/账户视图模型、测试连接状态，
 * 以及详情页（ProviderSettingsPanel）回调到 SettingsView 的动作集合。
 */
export interface AccountInfo {
  id: string
  label: string
  enabled: boolean
  apiKey: string
  maskedApiKey: string
  budget?: number
  authMode: 'apikey' | 'weblogin'
  webTokenStatus: 'none' | 'active' | 'expired'
  apiKeyDirty: boolean
  qoderCookieSource?: 'session' | 'manual'
  qoderSite?: 'international' | 'china'
  qoderManualCapture: string
  qoderCaptureDirty: boolean
  qoderHasWebToken: boolean
  qoderParse?: { ok: boolean; site?: string; cookieCount?: number }
  stepfunCookieSource?: 'session' | 'manual'
  stepfunManualToken: string
  stepfunTokenDirty: boolean
  stepfunHasWebToken: boolean
  region?: 'cn' | 'global'
}

export interface ProviderInfo {
  key: string
  label: string
  accounts: AccountInfo[]
}

export interface TestState {
  status: 'idle' | 'testing' | 'success' | 'failed'
  error?: string
  latencyMs?: number
  sample?: { used: number; total: number; level: string }
}

/**
 * 详情页内会改动状态或发起 IPC 的动作：状态与自动保存逻辑都在 SettingsView，
 * 详情页只渲染，通过这组回调把操作交回父级。
 */
export interface ProviderSettingsActions {
  addAccount: (providerKey: string) => void
  removeAccount: (providerKey: string, accountId: string) => void
  getTestState: (providerKey: string, accountId: string) => TestState | undefined
  testTitle: (providerKey: string, accountId: string) => string
  testConnection: (info: ProviderInfo, account: AccountInfo) => void
  deepseekWebLogin: (account: AccountInfo) => void
  deepseekWebLogout: (account: AccountInfo) => void
  mimoWebLogin: (account: AccountInfo) => void
  mimoWebLogout: (account: AccountInfo) => void
  qoderWebLogin: (account: AccountInfo) => void
  qoderWebLogout: (account: AccountInfo) => void
  qwenWebLogin: (account: AccountInfo) => void
  qwenWebLogout: (account: AccountInfo) => void
  stepfunWebLogin: (account: AccountInfo) => void
  stepfunWebLogout: (account: AccountInfo) => void
  onApiKeyInput: (account: AccountInfo, event: Event) => void
  onQoderCaptureInput: (account: AccountInfo) => void
  validateQoderCapture: (account: AccountInfo) => void
  qoderSiteName: (site?: string) => string
  onStepfunTokenInput: (account: AccountInfo) => void
}
