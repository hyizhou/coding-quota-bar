<template>
  <!-- 订阅信息卡片 -->
  <div class="subscription-card card" v-if="account.subscription">
    <div class="sub-header">
      <span class="sub-plan">{{ account.subscription.plan }}</span>
      <span class="sub-status" v-if="account.subscription.status === 'EXPIRED'" style="color: #ef4444">{{ t('provider.expired') }}</span>
    </div>
    <div class="sub-detail">
      <span v-if="account.subscription.nextRenewTime">
        {{ t('subscription.nextRenew') }} {{ formatDate(account.subscription.nextRenewTime) }}
      </span>
      <span :class="account.subscription.autoRenew ? 'auto-renew-on' : 'auto-renew-off'">
        {{ t('subscription.autoRenew') }}: {{ account.subscription.autoRenew ? t('subscription.yes') : t('subscription.no') }}
      </span>
    </div>
  </div>

  <!-- 账户余额 -->
  <div class="balance-card card" v-if="account.balance">
    <div class="balance-header">
      <span class="balance-label">{{ t('quota.mimoBalance') }}</span>
      <span class="balance-value">{{ currencySymbol }}{{ account.balance.total }}</span>
    </div>
    <div class="balance-detail" v-if="hasBalanceDetail">
      <span v-if="parseFloat(account.balance.gift) > 0" class="balance-item">
        {{ t('quota.mimoGiftBalance') }} {{ currencySymbol }}{{ account.balance.gift }}
      </span>
      <span v-if="parseFloat(account.balance.cash) > 0" class="balance-item">
        {{ t('quota.mimoCashBalance') }} {{ currencySymbol }}{{ account.balance.cash }}
      </span>
      <span v-if="parseFloat(account.balance.frozen) > 0" class="balance-item frozen">
        {{ t('quota.mimoFrozenBalance') }} {{ currencySymbol }}{{ account.balance.frozen }}
      </span>
    </div>
  </div>

  <!-- 本月用量（主指标） -->
  <div class="credits-card" v-if="monthlyQuota">
    <div class="credits-top">
      <span class="credits-label">{{ $t(monthlyQuota.label) }}</span>
      <span class="credits-percent" :class="monthlyQuota.color">{{ Math.round(monthlyQuota.usageRate) }}%</span>
    </div>
    <div class="credits-bar">
      <div class="credits-fill" :class="monthlyQuota.color" :style="{ width: monthlyQuota.usageRate + '%' }"></div>
    </div>
    <div class="credits-bottom">
      <span class="credits-values">{{ formatCredits(monthlyQuota.used) }} / {{ formatCredits(monthlyQuota.total) }} Credits</span>
      <span class="credits-reset">{{ formatReset(monthlyQuota.resetAt) }}</span>
    </div>
  </div>

  <!-- 补偿额度（如果有） -->
  <div class="quota-row-single" v-for="q in compensationQuotas" :key="q.label">
    <QuotaCard
      :label="q.label"
      :labelParams="q.labelParams"
      :usageRate="q.usageRate"
      :resetAt="q.resetAt"
      :color="q.color"
    />
  </div>

  <!-- 按月 Token 用量图表 -->
  <div v-if="hasModelHistory" class="usage-stats">
    <div class="stats-tabs-row">
      <span class="chart-title">{{ t('quota.mimoTokenUsage') }}</span>
    </div>
    <div class="model-chart-card">
      <div class="model-chart-wrapper">
        <Bar :data="chartData" :options="chartOpts" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Bar } from 'vue-chartjs'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  Tooltip,
  Filler
} from 'chart.js'
import QuotaCard from './QuotaCard.vue'
import type { AccountUsageData, ModelTokenRecord } from '../types'
import { useTheme } from '../composables/useTheme'

ChartJS.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, Tooltip, Filler)

const { t, locale } = useI18n()
const { isDark } = useTheme()

const props = defineProps<{ account: AccountUsageData }>()

const monthlyQuota = computed(() =>
  props.account.quotas.find(q => q.label === 'quota.mimoMonthlyUsage')
)

const compensationQuotas = computed(() =>
  props.account.quotas.filter(q => q.label === 'quota.mimoCompensation')
)

const hasModelHistory = computed(() => props.account.modelHistory30d.length > 0)

const currencySymbol = computed(() => {
  const c = props.account.balance?.currency ?? props.account.currency
  return c === 'CNY' ? '¥' : '$'
})

const hasBalanceDetail = computed(() => {
  const b = props.account.balance
  if (!b) return false
  return parseFloat(b.gift) > 0 || parseFloat(b.cash) > 0 || parseFloat(b.frozen) > 0
})

function formatCredits(n: number): string {
  return n.toLocaleString()
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return `${n}`
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleDateString(undefined, { year: 'numeric', month: '2-digit', day: '2-digit' })
  } catch {
    return iso
  }
}

function formatReset(iso: string): string {
  if (!iso) return ''
  try {
    const d = new Date(iso)
    if (isNaN(d.getTime())) return ''
    const diff = Math.ceil((d.getTime() - Date.now()) / 60000)
    if (diff < 1440) {
      return d.toLocaleTimeString(locale.value, { hour: '2-digit', minute: '2-digit', hour12: false })
    }
    return d.toLocaleDateString(locale.value, { month: 'short', day: 'numeric' })
  } catch { return '' }
}

// 按月图表：每天一根堆叠柱子（Cache Hit / Cache Miss / Output）+ Requests 折线
interface DayDetail {
  cacheHit: number
  cacheMiss: number
  output: number
  requests: number
}

const now = new Date()
const year = now.getFullYear()
const month = now.getMonth() + 1
const lastDay = now.getDate()

const dayLabels: string[] = []
const dayKeys: string[] = []
const monthStr = String(month).padStart(2, '0')
for (let d = 1; d <= lastDay; d++) {
  const ds = String(d).padStart(2, '0')
  dayKeys.push(`${year}-${monthStr}-${ds}`)
  dayLabels.push(ds)
}

const dayMap = computed(() => {
  const map = new Map<string, DayDetail>()
  for (const r of props.account.modelHistory30d) {
    const day = r.date.slice(0, 10)
    const existing = map.get(day) || { cacheHit: 0, cacheMiss: 0, output: 0, requests: 0 }
    existing.cacheHit += r.cacheHitTokens ?? 0
    existing.cacheMiss += r.cacheMissTokens ?? 0
    existing.output += r.responseTokens ?? 0
    existing.requests += r.requests ?? 0
    map.set(day, existing)
  }
  return map
})

const cacheHitArr = computed(() => dayKeys.map(k => dayMap.value.get(k)?.cacheHit ?? 0))
const cacheMissArr = computed(() => dayKeys.map(k => dayMap.value.get(k)?.cacheMiss ?? 0))
const outputArr = computed(() => dayKeys.map(k => dayMap.value.get(k)?.output ?? 0))
const requestsArr = computed(() => dayKeys.map(k => dayMap.value.get(k)?.requests ?? 0))

const chartData = computed(() => ({
  labels: dayLabels,
  datasets: [
    {
      type: 'bar' as const,
      label: t('main.ttCacheHit'),
      data: cacheHitArr.value,
      backgroundColor: '#A0DCFD',
      hoverBackgroundColor: '#A0DCFD',
      borderRadius: 2,
      borderSkipped: false,
      yAxisID: 'y',
      stack: 'tokens',
      order: 4,
    },
    {
      type: 'bar' as const,
      label: t('main.ttCacheMiss'),
      data: cacheMissArr.value,
      backgroundColor: '#60B3FE',
      hoverBackgroundColor: '#60B3FE',
      borderRadius: 0,
      borderSkipped: false,
      yAxisID: 'y',
      stack: 'tokens',
      order: 3,
    },
    {
      type: 'bar' as const,
      label: t('main.ttOutput'),
      data: outputArr.value,
      backgroundColor: '#0C70F3',
      hoverBackgroundColor: '#0C70F3',
      borderRadius: 0,
      borderSkipped: false,
      yAxisID: 'y',
      stack: 'tokens',
      order: 2,
    },
    {
      type: 'line' as const,
      label: 'Requests',
      data: requestsArr.value,
      borderColor: 'rgba(16, 185, 129, 0.45)',
      backgroundColor: 'rgba(16, 185, 129, 0.15)',
      pointRadius: 0,
      pointHoverRadius: 0,
      borderWidth: 1.5,
      borderDash: [4, 3],
      tension: 0.3,
      fill: false,
      yAxisID: 'y1',
      order: 1,
    },
  ],
}))

const chartOpts = computed(() => ({
  responsive: true,
  maintainAspectRatio: false,
  interaction: { mode: 'index' as const, intersect: false },
  plugins: {
    legend: { display: false },
    tooltip: {
      backgroundColor: isDark.value ? 'rgba(40,40,40,0.92)' : 'rgba(0,0,0,0.8)',
      titleColor: isDark.value ? '#e0e0e0' : '#fff',
      bodyColor: isDark.value ? '#ccc' : '#fff',
      padding: 8,
      cornerRadius: 4,
      bodyFont: { size: 11 },
      titleFont: { size: 11, weight: 'bold' as const },
      footerFont: { size: 11, weight: 'bold' as const },
      caretSize: 6,
      caretPadding: 4,
      itemSort: (a: any, b: any) => a.datasetIndex - b.datasetIndex,
      callbacks: {
        title(items: any) {
          const idx = items[0]?.dataIndex
          if (idx == null) return ''
          const dayKey = dayKeys[idx]
          const detail = dayMap.value.get(dayKey)
          const total = (detail?.cacheHit ?? 0) + (detail?.cacheMiss ?? 0) + (detail?.output ?? 0)
          return `${dayKey}    ${formatCount(total)}`
        },
        label(ctx: any) {
          if (ctx.dataset.type === 'line') return null
          return `${ctx.dataset.label}: ${formatCount(ctx.raw)}`
        },
        footer(items: any[]) {
          const idx = items[0]?.dataIndex
          const dayKey = idx != null ? dayKeys[idx] : ''
          const detail = dayMap.value.get(dayKey)
          return `${t('main.ttRequests')}: ${detail?.requests ?? 0}`
        },
      },
    },
  },
  scales: {
    x: {
      ticks: { color: isDark.value ? '#666' : '#999', font: { size: 8 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 10 },
      grid: { display: false },
      border: { display: false },
    },
    y: {
      position: 'left' as const,
      stacked: true,
      ticks: { color: isDark.value ? '#666' : '#999', font: { size: 8 }, callback: (v: number) => formatCount(v), maxTicksLimit: 4 },
      grid: { color: isDark.value ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)' },
      border: { display: false },
    },
    y1: {
      display: false,
      position: 'right' as const,
      grid: { display: false },
      border: { display: false },
    },
  },
  layout: { padding: { top: 2, bottom: 0, left: 0, right: 0 } },
}))
</script>

<style scoped>
.subscription-card {
  margin-bottom: 6px;
}

.sub-header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 2px;
}

.sub-plan {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-heading);
}

.sub-status {
  font-size: 11px;
  font-weight: 600;
}

.sub-detail {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 11px;
  color: var(--text-tertiary);
}

.auto-renew-on {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 4px;
  background: rgba(34, 197, 94, 0.1);
  color: #22c55e;
  border: 1px solid rgba(34, 197, 94, 0.2);
}

.auto-renew-off {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 4px;
  background: rgba(156, 163, 175, 0.1);
  color: var(--text-tertiary);
  border: 1px solid rgba(156, 163, 175, 0.2);
}

.balance-card {
  margin-bottom: 6px;
}

.balance-header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
}

.balance-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-heading);
}

.balance-value {
  font-size: 20px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--text-primary);
}

.balance-detail {
  display: flex;
  gap: 10px;
  margin-top: 4px;
}

.balance-item {
  font-size: 11px;
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
}

.balance-item.frozen {
  color: var(--text-tertiary);
}

.credits-card {
  padding: 8px 10px;
  background: var(--bg-card);
  border-radius: 8px;
  box-shadow: var(--shadow-card);
  transition: background 0.2s, box-shadow 0.2s;
}

.credits-card:hover {
  background: var(--bg-card-hover);
  box-shadow: var(--shadow-card-hover);
}

.credits-top {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 5px;
}

.credits-label {
  font-weight: 600;
  font-size: 13px;
  color: var(--text-heading);
}

.credits-percent {
  font-weight: 700;
  font-size: 16px;
  font-variant-numeric: tabular-nums;
  color: var(--text-primary);
}
.credits-percent.yellow { color: #a16207; }
.credits-percent.red { color: #dc2626; }

.credits-bar {
  height: 6px;
  background: var(--border-subtle);
  border-radius: 3px;
  overflow: hidden;
  margin-bottom: 5px;
}

.credits-fill {
  height: 100%;
  border-radius: 3px;
  transition: width 0.5s cubic-bezier(0.4, 0, 0.2, 1);
}
.credits-fill.green { background: linear-gradient(90deg, #4ade80, #22c55e); }
.credits-fill.yellow { background: linear-gradient(90deg, #facc15, #eab308); }
.credits-fill.red { background: linear-gradient(90deg, #f87171, #ef4444); }

.credits-bottom {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.credits-values {
  font-size: 11px;
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
}

.credits-reset {
  font-size: 10px;
  color: var(--text-tertiary);
}

.usage-stats {
  margin-top: 8px;
}

.stats-tabs-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
}

.chart-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-heading);
}

.model-chart-card {
  padding: 6px 0;
}

.model-chart-wrapper {
  height: 120px;
  width: 100%;
}
</style>
