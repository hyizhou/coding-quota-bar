// 总览卡片指标逻辑：按服务商规则选取主/次指标并格式化展示文本（纯函数，供 overview 组件族共用）
import i18n from '../../locales'
import type { AccountUsageData, ProviderUsageData, QuotaItem } from '../../types'

const t = i18n.global.t

export type MetricColor = 'green' | 'yellow' | 'red' | 'neutral'

export interface OverviewMetric {
  label: string
  value: string
  detail: string
  usageRate: number
  color: MetricColor
  hideBar?: boolean
}

export interface SecondaryMetric {
  label: string
  value: string
  color: MetricColor
}

export interface OverviewCard {
  provider: ProviderUsageData
  account: AccountUsageData
  accountLabel: string
  primary: OverviewMetric
  secondary: SecondaryMetric[]
}

export function buildOverviewCard(provider: ProviderUsageData, account: AccountUsageData): OverviewCard {
  return {
    provider,
    account,
    accountLabel: provider.accounts.length > 1 ? account.label || account.id : '',
    primary: selectPrimaryMetric(provider.key, account),
    secondary: selectSecondaryMetrics(provider.key, account),
  }
}

export function formatError(error: string): string {
  return error.replace(/^\[[\w]+\]\s*/, '')
}

function selectPrimaryMetric(providerKey: string, account: AccountUsageData): OverviewMetric {
  if (account.loading) {
    return {
      label: t('main.loading'),
      value: '—',
      detail: '',
      usageRate: 0,
      color: 'neutral',
      hideBar: true,
    }
  }

  if (account.error) {
    return {
      label: t('overview.unavailable'),
      value: '!',
      detail: formatError(account.error),
      usageRate: 100,
      color: 'red',
      hideBar: true,
    }
  }

  if (providerKey === 'zhipu') {
    const hourly = account.quotas.find(q => q.limitType === 'tokens' && q.label === 'quota.tokensLimit')
    const token = hourly || account.quotas.find(q => q.limitType === 'tokens')
    return quotaMetric(token, t('overview.zaiPrimary'))
  }

  if (providerKey === 'minimax') {
    const generalDaily = account.quotas.find(q =>
      q.limitType === 'MiniMax' &&
      (q.label === 'quota.minimaxDaily' || q.label === 'quota.minimaxDailyUnlimited')
    )
    return quotaMetric(generalDaily, t('overview.minimaxPrimary'))
  }

  if (providerKey === 'deepseek') {
    return balanceMetric(account)
  }

  if (providerKey === 'opencode-go') {
    // 5h 滚动窗口是最该盯的——重置最快；weekly/monthly 走 secondary
    const rolling = account.quotas.find(q => q.limitType === '5h')
    return quotaMetric(rolling, t('quota.opencodeGo5h'))
  }

  if (providerKey === 'openrouter') {
    // 总览只看账户余额；Key 级用量在详情区域查看（多数 Key 未设限额，限额参考意义低）
    const balance = account.quotas.find(q => q.limitType === 'openrouter-balance')
    return {
      label: t('quota.openrouterBalance'),
      value: balance ? formatCurrency(Number(balance.labelParams?.amount ?? 0), 'USD') : '--',
      detail: t('overview.balanceOnly'),
      usageRate: 0,
      color: 'neutral',
      hideBar: true,
    }
  }

  return quotaMetric(findTightestQuota(account.quotas), t('overview.primaryQuota'))
}

function selectSecondaryMetrics(providerKey: string, account: AccountUsageData): SecondaryMetric[] {
  if (account.error || account.loading) return []

  if (providerKey === 'zhipu') {
    return [
      account.quotas.find(q => q.limitType === 'tokens' && q.label === 'quota.tokensLimitDaily'),
      account.quotas.find(q => q.limitType === 'mcp'),
    ].filter((q): q is QuotaItem => !!q).map(q => secondaryFromQuota(q))
  }

  if (providerKey === 'minimax') {
    return account.quotas
      .filter(q => q.limitType === 'MiniMax' && (q.label === 'quota.minimaxWeekly' || q.label === 'quota.minimaxWeeklyUnlimited'))
      .map(q => secondaryFromQuota(q))
  }

  if (providerKey === 'deepseek') {
    const details = account.balance
      ? [
          { label: t('quota.deepseekGranted'), value: formatMoney(account.balance.gift, account.balance.currency) },
          { label: t('quota.deepseekToppedUp'), value: formatMoney(account.balance.cash, account.balance.currency) },
        ]
      : account.quotas
          .filter(q => q.label === 'quota.deepseekGranted' || q.label === 'quota.deepseekToppedUp')
          .map(q => ({ label: t(q.label), value: formatCurrency(q.total, q.currency || account.currency) }))
    return details.filter(d => d.value).map(d => ({ ...d, color: 'neutral' as const }))
  }

  if (providerKey === 'opencode-go') {
    return account.quotas
      .filter(q => q.limitType === 'weekly' || q.limitType === 'monthly')
      .map(q => secondaryFromQuota(q))
  }

  if (providerKey === 'openrouter') {
    return []
  }

  return account.quotas
    .filter(q => !q.hideBar)
    .slice(0, 2)
    .map(q => secondaryFromQuota(q))
}

function quotaMetric(q: QuotaItem | undefined, fallbackLabel: string): OverviewMetric {
  if (!q) {
    return {
      label: fallbackLabel,
      value: '--',
      detail: t('overview.noQuota'),
      usageRate: 0,
      color: 'neutral',
      hideBar: true,
    }
  }

  const label = t(q.label, q.labelParams ?? {})
  if (q.total === 0) {
    return {
      label,
      value: '∞',
      detail: t('quota.unlimited'),
      usageRate: 0,
      color: 'neutral',
      hideBar: true,
    }
  }

  const usageRate = clampPercent(q.usageRate)
  const reset = formatResetCountdown(q.resetAt)
  return {
    label,
    value: formatRemaining(q),
    detail: [formatUsed(q), reset].filter(Boolean).join(' · '),
    usageRate,
    color: q.color,
  }
}

function balanceMetric(account: AccountUsageData): OverviewMetric {
  const currency = account.balance?.currency || account.currency
  const total = account.balance?.total
    ? formatMoney(account.balance.total, currency)
    : formatCurrency(account.quotas.find(q => q.label === 'quota.deepseekTotalBalance')?.total ?? 0, currency)
  const cost = account.quotas.find(q => q.label === 'quota.deepseekMonthlyCost')
  return {
    label: t('quota.deepseekTotalBalance'),
    value: total,
    detail: cost ? `${t('quota.deepseekMonthlyCost')} ${formatCurrency(cost.total, cost.currency || currency)}` : t('overview.balanceOnly'),
    usageRate: 0,
    color: 'neutral',
    hideBar: true,
  }
}

function secondaryFromQuota(q: QuotaItem): SecondaryMetric {
  return {
    label: t(q.label, q.labelParams ?? {}),
    value: q.total === 0 ? '∞' : formatRemaining(q),
    color: q.total === 0 ? 'neutral' : q.color,
  }
}

function findTightestQuota(quotas: QuotaItem[]): QuotaItem | undefined {
  return [...quotas]
    .filter(q => q.total > 0 && !q.hideBar)
    .sort((a, b) => remainingPercent(a) - remainingPercent(b))[0] || quotas[0]
}

function remainingPercent(q: QuotaItem): number {
  if (q.total === 0) return 100
  return 100 - clampPercent(q.usageRate)
}

function formatRemaining(q: QuotaItem): string {
  if (q.displayUnit === 'count') {
    return `${Math.max(0, Math.round(q.total - q.used))}/${Math.max(0, Math.round(q.total))}`
  }
  return `${Math.round(remainingPercent(q))}%`
}

function formatUsed(q: QuotaItem): string {
  if (q.displayUnit === 'count') {
    return t('overview.countUsed', { n: Math.max(0, Math.round(q.used)) })
  }
  return t('quota.usedPercent', { n: Math.round(clampPercent(q.usageRate)) })
}

function formatResetCountdown(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const diffMs = d.getTime() - Date.now()
  if (diffMs <= 0) return t('overview.resetSoon')

  const totalMinutes = Math.ceil(diffMs / 60000)
  if (totalMinutes < 60) {
    return t('overview.resetInMinutes', { n: totalMinutes })
  }

  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours < 24) {
    return minutes > 0
      ? t('overview.resetInHoursMinutes', { h: hours, m: minutes })
      : t('overview.resetInHours', { n: hours })
  }

  const days = Math.floor(hours / 24)
  const restHours = hours % 24
  return restHours > 0
    ? t('overview.resetInDaysHours', { d: days, h: restHours })
    : t('overview.resetInDays', { n: days })
}

function formatMoney(value: string, currency?: string): string {
  const n = Number(value)
  return Number.isFinite(n) ? formatCurrency(n, currency) : `${currencySymbol(currency)}${value}`
}

function formatCurrency(value: number, currency?: string): string {
  return `${currencySymbol(currency)}${value.toFixed(2)}`
}

function currencySymbol(currency?: string): string {
  switch (currency?.toUpperCase()) {
    case 'USD': return '$'
    case 'EUR': return '€'
    case 'GBP': return '£'
    default: return '¥'
  }
}

function clampPercent(n: number): number {
  return Math.max(0, Math.min(100, Number.isFinite(n) ? n : 0))
}
