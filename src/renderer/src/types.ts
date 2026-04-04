/**
 * Renderer 进程共享类型定义
 */

export interface ProviderUsageData {
  name: string
  used: number
  total: number
  percent: number
  expiresAt: string
  color: 'green' | 'yellow' | 'red'
}

export interface UsageState {
  providers: ProviderUsageData[]
  lastUpdate: string
  overallPercent: number
}

export interface ProviderConfig {
  enabled: boolean
  apiKey: string
  [key: string]: unknown
}

export interface AppConfig {
  refreshInterval: number
  providers: Record<string, ProviderConfig>
  display: {
    colorThresholds: {
      green: number
      yellow: number
    }
  }
  autoStart: boolean
  language?: string
}

export interface ElectronAPI {
  getDevMode: () => Promise<boolean>
  getUsageData: () => Promise<UsageState | null>
  refreshUsage: () => Promise<UsageState | null>
  getConfig: () => Promise<AppConfig | null>
  updateConfig: (updates: unknown) => Promise<AppConfig | null>
  onShowSettings: (callback: () => void) => void
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
