<template>
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
  <MiMoQuotaCard v-if="monthlyQuota" v-bind="monthlyQuota" />

  <!-- 补偿额度（如果有） -->
  <MiMoQuotaCard v-for="q in compensationQuotas" :key="q.label" v-bind="q" />

  <!-- 每月用量 -->
  <div class="usage-stats">
    <div class="stats-tabs-row">
      <span class="chart-title">{{ t('main.monthlyUsage') }}</span>
      <div class="month-selector">
        <select class="month-select" :value="monthValue" @change="onMonthChange">
          <option v-for="m in monthOptions" :key="m.value" :value="m.value">{{ m.label }}</option>
        </select>
      </div>
    </div>
    <div v-if="loading" class="chart-loading">...</div>
    <template v-else>
      <template v-if="hasChartData">
        <!-- Token 总消耗 -->
        <div class="model-chart-card">
          <div class="model-header">
            <span class="model-name">{{ t('quota.mimoTokenUsage') }}</span>
          </div>
          <div class="model-chart-wrapper">
            <Bar :data="tokenChartData" :options="tokenChartOpts" />
          </div>
        </div>
        <!-- 请求次数 -->
        <div class="model-chart-card">
          <div class="model-header">
            <span class="model-name">{{ t('main.ttRequests') }}</span>
          </div>
          <div class="model-chart-wrapper">
            <Bar :data="requestsChartData" :options="requestsChartOpts" />
          </div>
        </div>
      </template>
      <div v-else class="no-data">{{ $t('main.noUsageData') }}</div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Bar } from 'vue-chartjs'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
} from 'chart.js'
import QuotaCard from './QuotaCard.vue'
import MiMoQuotaCard from './MiMoQuotaCard.vue'
import type { AccountUsageData, ModelTokenRecord } from '../types'
import { useTheme } from '../composables/useTheme'

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip)

const { t, locale } = useI18n()
const { isDark } = useTheme()

const props = defineProps<{ account: AccountUsageData }>()

const monthlyQuota = computed(() =>
  props.account.quotas.find(q => q.label === 'quota.mimoMonthlyUsage')
)

const compensationQuotas = computed(() =>
  props.account.quotas.filter(q => q.label === 'quota.mimoCompensation')
)

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

// ===== 月份选择器 =====
const STORAGE_KEY_MONTH = 'mimo-selected-month'

function restoreMonth(): { year: number; month: number } {
  try {
    const saved = localStorage.getItem(STORAGE_KEY_MONTH)
    if (saved) {
      const [y, m] = saved.split('-').map(Number)
      if (y > 2020 && m >= 1 && m <= 12) return { year: y, month: m }
    }
  } catch {}
  const now = new Date()
  return { year: now.getFullYear(), month: now.getMonth() + 1 }
}

const restored = restoreMonth()
const selectedYear = ref(restored.year)
const selectedMonth = ref(restored.month)
const loading = ref(false)

const monthValue = computed(() => `${selectedYear.value}-${String(selectedMonth.value).padStart(2, '0')}`)

function saveSelectedMonth() {
  localStorage.setItem(STORAGE_KEY_MONTH, `${selectedYear.value}-${selectedMonth.value}`)
}

const monthOptions = computed(() => {
  const n = new Date()
  const options: { value: string; label: string }[] = []
  let y = n.getFullYear(), m = n.getMonth() + 1
  for (let i = 0; i < 12; i++) {
    const mm = String(m).padStart(2, '0')
    options.push({ value: `${y}-${mm}`, label: t('main.monthFormat', { year: y, month: mm }) })
    m--
    if (m === 0) { m = 12; y-- }
  }
  return options
})

const isCurrentMonth = computed(() => {
  const n = new Date()
  return selectedYear.value === n.getFullYear() && selectedMonth.value === n.getMonth() + 1
})

// ===== 月度数据 =====
const monthRecords = ref<ModelTokenRecord[]>([])

function loadData() {
  if (isCurrentMonth.value) {
    monthRecords.value = props.account.modelHistory30d
  } else {
    monthRecords.value = []
    fetchMonthData()
  }
}

async function fetchMonthData() {
  if (isCurrentMonth.value) {
    monthRecords.value = props.account.modelHistory30d
    return
  }
  loading.value = true
  try {
    const result = await window.electronAPI.mimoFetchMonthUsage(
      props.account.id, selectedYear.value, selectedMonth.value
    )
    monthRecords.value = result || []
  } catch (e) {
    console.warn('[MiMoSection] Failed to fetch month data:', e)
    monthRecords.value = []
  } finally {
    loading.value = false
  }
}

async function onMonthChange(e: Event) {
  const val = (e.target as HTMLSelectElement).value
  const [y, m] = val.split('-').map(Number)
  selectedYear.value = y
  selectedMonth.value = m
  saveSelectedMonth()
  await fetchMonthData()
}

onMounted(loadData)

watch(() => props.account.modelHistory30d, (newData) => {
  if (isCurrentMonth.value) {
    monthRecords.value = newData
  }
})

// ===== 图表数据 =====
interface DayDetail {
  cacheHit: number
  cacheMiss: number
  output: number
  requests: number
}

const chartDays = computed(() => {
  const y = selectedYear.value
  const m = selectedMonth.value
  const lastDay = new Date(y, m, 0).getDate()
  const monthStr = String(m).padStart(2, '0')
  const keys: string[] = []
  const labels: string[] = []
  for (let d = 1; d <= lastDay; d++) {
    const ds = String(d).padStart(2, '0')
    keys.push(`${y}-${monthStr}-${ds}`)
    labels.push(ds)
  }
  return { keys, labels }
})

const dayMap = computed(() => {
  const map = new Map<string, DayDetail>()
  for (const r of monthRecords.value) {
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

const hasChartData = computed(() => monthRecords.value.length > 0)

// Token 总消耗图表
const tokenChartData = computed(() => ({
  labels: chartDays.value.labels,
  datasets: [
    {
      label: t('main.ttCacheHit'),
      data: chartDays.value.keys.map(k => dayMap.value.get(k)?.cacheHit ?? 0),
      backgroundColor: '#A0DCFD',
      hoverBackgroundColor: '#A0DCFD',
      borderRadius: 2,
      borderSkipped: false,
      stack: 'tokens',
    },
    {
      label: t('main.ttCacheMiss'),
      data: chartDays.value.keys.map(k => dayMap.value.get(k)?.cacheMiss ?? 0),
      backgroundColor: '#60B3FE',
      hoverBackgroundColor: '#60B3FE',
      borderRadius: 0,
      borderSkipped: false,
      stack: 'tokens',
    },
    {
      label: t('main.ttOutput'),
      data: chartDays.value.keys.map(k => dayMap.value.get(k)?.output ?? 0),
      backgroundColor: '#0C70F3',
      hoverBackgroundColor: '#0C70F3',
      borderRadius: 0,
      borderSkipped: false,
      stack: 'tokens',
    },
  ],
}))

const tokenChartOpts = computed(() => ({
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
      caretSize: 6,
      caretPadding: 4,
      callbacks: {
        title(items: any) {
          const idx = items[0]?.dataIndex
          if (idx == null) return ''
          const dayKey = chartDays.value.keys[idx]
          const detail = dayMap.value.get(dayKey)
          const total = (detail?.cacheHit ?? 0) + (detail?.cacheMiss ?? 0) + (detail?.output ?? 0)
          return `${dayKey}    ${formatCount(total)}`
        },
        label(ctx: any) {
          return `${ctx.dataset.label}: ${formatCount(ctx.raw)}`
        },
      },
    },
  },
  scales: {
    x: {
      stacked: true,
      ticks: { color: isDark.value ? '#666' : '#999', font: { size: 8 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 10 },
      grid: { display: false },
      border: { display: false },
    },
    y: {
      stacked: true,
      ticks: { color: isDark.value ? '#666' : '#999', font: { size: 8 }, callback: (v: string | number) => formatCount(Number(v)), maxTicksLimit: 4 },
      grid: { color: isDark.value ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)' },
      border: { display: false },
    },
  },
  layout: { padding: { top: 2, bottom: 0, left: 0, right: 0 } },
}))

// 请求次数图表
const requestsChartData = computed(() => ({
  labels: chartDays.value.labels,
  datasets: [
    {
      label: t('main.ttRequests'),
      data: chartDays.value.keys.map(k => dayMap.value.get(k)?.requests ?? 0),
      backgroundColor: 'rgba(16, 185, 129, 0.6)',
      hoverBackgroundColor: 'rgba(16, 185, 129, 0.8)',
      borderRadius: 2,
      borderSkipped: false,
    },
  ],
}))

const requestsChartOpts = computed(() => ({
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
      caretSize: 6,
      caretPadding: 4,
      callbacks: {
        title(items: any) {
          const idx = items[0]?.dataIndex
          if (idx == null) return ''
          return chartDays.value.keys[idx]
        },
        label(ctx: any) {
          return `${ctx.raw}`
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
      ticks: { color: isDark.value ? '#666' : '#999', font: { size: 8 }, maxTicksLimit: 4 },
      grid: { color: isDark.value ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)' },
      border: { display: false },
    },
  },
  layout: { padding: { top: 2, bottom: 0, left: 0, right: 0 } },
}))
</script>

<style scoped>
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

.month-selector {
  display: flex;
  align-items: center;
}

.month-select {
  font-size: 11px;
  padding: 2px 4px;
  border: 1px solid var(--border-subtle);
  border-radius: 4px;
  background: var(--bg-card);
  color: var(--text-primary);
  cursor: pointer;
  outline: none;
}

.month-select:focus {
  border-color: var(--border-active);
}

.model-chart-card {
  padding: 6px 0;
}

.model-header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 2px;
}

.model-name {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-secondary);
}

.model-chart-wrapper {
  height: 120px;
  width: 100%;
}

.no-data {
  text-align: center;
  color: var(--text-tertiary);
  font-size: 12px;
  padding: 20px 0;
}

.chart-loading {
  text-align: center;
  color: var(--text-tertiary);
  font-size: 12px;
  padding: 20px 0;
}
</style>
