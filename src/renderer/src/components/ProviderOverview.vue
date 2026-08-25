<template>
  <div class="overview">
    <button
      v-for="card in cards"
      :key="card.provider.key"
      type="button"
      class="overview-card"
      :class="{ 'has-error': !!card.account.error }"
      @click="$emit('select-provider', card.provider.key)"
    >
      <div class="card-head">
        <div class="provider-title">
          <span class="provider-name">{{ card.provider.name }}</span>
          <span v-if="card.accountLabel" class="account-label">{{ card.accountLabel }}</span>
        </div>
        <span class="metric-value" :class="card.primary.color">{{ card.primary.value }}</span>
      </div>

      <template v-if="card.account.error">
        <div class="error-line">{{ formatError(card.account.error) }}</div>
      </template>
      <template v-else>
        <div class="metric-line">
          <span class="metric-label">{{ card.primary.label }}</span>
          <span class="metric-detail">{{ card.primary.detail }}</span>
        </div>
        <div v-if="!card.primary.hideBar" class="overview-bar">
          <div class="overview-fill" :class="card.primary.color" :style="{ width: `${card.primary.usageRate}%` }"></div>
        </div>
        <div v-if="card.secondary.length > 0" class="secondary-list">
          <span v-for="item in card.secondary" :key="item.label" class="secondary-chip">
            <span class="chip-label">{{ item.label }}</span>
            <span class="chip-value" :class="item.color">{{ item.value }}</span>
          </span>
        </div>
      </template>
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AccountUsageData, ProviderUsageData, QuotaItem } from '../types'

const props = defineProps<{
  providers: ProviderUsageData[]
  activeAccounts: Record<string, string>
}>()

defineEmits<{
  'select-provider': [key: string]
}>()

const { t, locale } = useI18n()

type MetricColor = 'green' | 'yellow' | 'red' | 'neutral'

interface OverviewMetric {
  label: string
  value: string
  detail: string
  usageRate: number
  color: MetricColor
  hideBar?: boolean
}

interface SecondaryMetric {
  label: string
  value: string
  color: MetricColor
}

interface OverviewCard {
  provider: ProviderUsageData
  account: AccountUsageData
  accountLabel: string
  primary: OverviewMetric
  secondary: SecondaryMetric[]
  sortValue: number
}

const cards = computed(() => {
  return props.providers
    .map(provider => buildCard(provider))
    .filter((card): card is OverviewCard => !!card)
    .sort((a, b) => {
      if (a.account.error && !b.account.error) return -1
      if (!a.account.error && b.account.error) return 1
      return a.sortValue - b.sortValue
    })
})

function buildCard(provider: ProviderUsageData): OverviewCard | undefined {
  const account = getAccount(provider)
  if (!account) return undefined
  const primary = selectPrimaryMetric(provider.key, account)
  const secondary = selectSecondaryMetrics(provider.key, account)
  const sortValue = account.error ? -1 : metricRemaining(primary)
  return {
    provider,
    account,
    accountLabel: provider.accounts.length > 1 ? account.label || account.id : '',
    primary,
    secondary,
    sortValue,
  }
}

function getAccount(provider: ProviderUsageData): AccountUsageData | undefined {
  const activeId = props.activeAccounts[provider.key]
  return provider.accounts.find(a => a.id === activeId) || provider.accounts[0]
}

function selectPrimaryMetric(providerKey: string, account: AccountUsageData): OverviewMetric {
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
    return quotaMetric(token, t('overview.zhipuPrimary'))
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

  return quotaMetric(findTightestQuota(account.quotas), t('overview.primaryQuota'))
}

function selectSecondaryMetrics(providerKey: string, account: AccountUsageData): SecondaryMetric[] {
  if (account.error) return []

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

  const label = t(q.label, q.labelParams)
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
    label: t(q.label, q.labelParams),
    value: q.total === 0 ? '∞' : formatRemaining(q),
    color: q.total === 0 ? 'neutral' : q.color,
  }
}

function findTightestQuota(quotas: QuotaItem[]): QuotaItem | undefined {
  return [...quotas]
    .filter(q => q.total > 0 && !q.hideBar)
    .sort((a, b) => remainingPercent(a) - remainingPercent(b))[0] || quotas[0]
}

function metricRemaining(metric: OverviewMetric): number {
  if (metric.hideBar && metric.value === '∞') return 100
  if (metric.color === 'neutral') return 100
  return 100 - metric.usageRate
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

function formatError(error: string): string {
  return error.replace(/^\[[\w]+\]\s*/, '')
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
</script>

<style scoped>
.overview {
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding-bottom: 4px;
}

.overview-card {
  width: 100%;
  display: block;
  padding: 9px 10px;
  border: none;
  border-radius: 8px;
  background: var(--bg-card);
  box-shadow: var(--shadow-card);
  color: inherit;
  text-align: left;
  cursor: pointer;
  transition: background 0.15s, box-shadow 0.15s, transform 0.15s;
}

.overview-card:hover {
  background: var(--bg-card-hover);
  box-shadow: var(--shadow-card-hover);
}

.overview-card:active {
  transform: translateY(1px);
}

.card-head,
.metric-line {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
}

.provider-title {
  min-width: 0;
  display: flex;
  align-items: baseline;
  gap: 6px;
}

.provider-name {
  font-size: 13px;
  font-weight: 700;
  color: var(--text-heading);
  white-space: nowrap;
}

.account-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 10px;
  color: var(--text-tertiary);
}

.metric-value {
  flex-shrink: 0;
  max-width: 45%;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 18px;
  line-height: 1;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  color: var(--text-primary);
}

.metric-value.yellow,
.chip-value.yellow {
  color: #a16207;
}

.metric-value.red,
.chip-value.red {
  color: var(--cqb-red-dark);
}

.metric-value.green,
.chip-value.green {
  color: var(--cqb-green-dark, var(--cqb-green));
}

.metric-line {
  margin-top: 5px;
}

.metric-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
}

.metric-detail {
  flex-shrink: 0;
  max-width: 58%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 10px;
  color: var(--text-tertiary);
  font-variant-numeric: tabular-nums;
}

.overview-bar {
  height: 5px;
  margin-top: 6px;
  background: var(--border-subtle);
  border-radius: 3px;
  overflow: hidden;
}

.overview-fill {
  height: 100%;
  border-radius: 3px;
  transition: width 0.35s cubic-bezier(0.4, 0, 0.2, 1);
}

.overview-fill.green { background: linear-gradient(90deg, var(--cqb-green-light), var(--cqb-green)); }
.overview-fill.yellow { background: linear-gradient(90deg, var(--cqb-yellow-light), var(--cqb-yellow)); }
.overview-fill.red { background: linear-gradient(90deg, var(--cqb-red-light), var(--cqb-red)); }

.secondary-list {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin-top: 7px;
}

.secondary-chip {
  min-width: 0;
  display: inline-flex;
  align-items: baseline;
  gap: 4px;
  padding: 3px 6px;
  border-radius: 5px;
  background: var(--bg-tab-bar);
  font-size: 10px;
  color: var(--text-tertiary);
}

.chip-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chip-value {
  flex-shrink: 0;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--text-secondary);
}

.error-line {
  margin-top: 6px;
  font-size: 11px;
  line-height: 1.35;
  color: var(--text-error);
}
</style>
