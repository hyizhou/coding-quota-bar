<template>
  <div class="balance-card">
    <div class="balance-header">
      <span class="balance-label">{{ $t('quota.deepseekTotalBalance') }}</span>
      <span class="balance-value">¥{{ totalBalance.toFixed(2) }}</span>
    </div>
    <div v-if="hasDetails" class="balance-details">
      <span v-for="d in details" :key="d.label" class="detail-item">
        {{ $t(d.label) }}: {{ d.label.includes('Usage') ? d.amount : '¥' + d.amount }}
      </span>
    </div>
    <template v-if="hasBudget">
      <div class="progress-bar">
        <div class="progress-fill" :class="barColor" :style="{ width: budgetRate + '%' }"></div>
      </div>
      <div class="budget-info">
        <span class="budget-hint">{{ $t('main.budgetRemaining', { n: budgetRemaining.toFixed(2) }) }}</span>
      </div>
    </template>
    <div class="budget-set-row">
      <span class="budget-set-label">¥</span>
      <input
        type="text"
        inputmode="decimal"
        class="budget-inline-input"
        :value="budget"
        @change="onBudgetChange"
        @blur="onBudgetChange"
        placeholder="设置总额度"
      />
    </div>
  </div>
  <!-- 网页登录模式：每月用量（费用 + Token） -->
  <div v-if="hasModelHistory" class="usage-stats">
    <div class="stats-tabs-row">
      <span class="chart-title">{{ $t('main.tokenStats') }}</span>
      <div class="month-selector">
        <button class="month-arrow" @click="prevMonth">&lt;</button>
        <span class="month-label">{{ monthLabel }}</span>
        <button class="month-arrow" :disabled="isCurrentMonth" @click="nextMonth">&gt;</button>
      </div>
    </div>
    <div v-if="loading" class="chart-loading">...</div>
    <template v-else>
      <!-- 费用统计图表 -->
      <div v-if="hasCostData" class="cost-chart-wrapper">
        <Bar :data="costChartData" :options="costChartOpts" />
      </div>
      <!-- 按模型展示 Token 图表 -->
      <div v-for="mg in modelGroups" :key="mg.name" class="model-chart-card">
        <div class="model-header">
          <span class="model-name">{{ mg.name }}</span>
          <div class="model-summary">
            <span class="model-stat">{{ formatCount(mg.totalTokens) }} tokens</span>
            <span class="model-stat-sep">·</span>
            <span class="model-stat">{{ mg.totalRequests }} requests</span>
          </div>
        </div>
        <div class="model-chart-wrapper">
          <Bar :data="mg.chartData" :options="getChartOpts(mg)" />
        </div>
      </div>
      <div v-if="modelGroups.length === 0" class="no-data">No data</div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Bar } from 'vue-chartjs'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, LineElement, PointElement, Tooltip, Filler
} from 'chart.js'
import type { AccountUsageData, ModelTokenRecord, ModelCostRecord } from '../types'
import { useTheme } from '../composables/useTheme'

ChartJS.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, Tooltip, Filler)

const { isDark } = useTheme()
const { t } = useI18n()

const props = defineProps<{
  account: AccountUsageData
}>()

const budget = ref<number | undefined>(undefined)

// Month selector state
const now = new Date()
const selectedYear = ref(now.getFullYear())
const selectedMonth = ref(now.getMonth() + 1)
const monthRecords = ref<ModelTokenRecord[]>([])
const monthCostRecords = ref<ModelCostRecord[]>([])
const loading = ref(false)

onMounted(async () => {
  const config = await window.electronAPI.getConfig()
  if (config?.providers?.deepseek) {
    const acc = config.providers.deepseek.accounts?.find((a: any) => a.id === props.account.id)
    if (acc && (acc as any).budget != null) {
      budget.value = (acc as any).budget
    }
  }
  monthRecords.value = props.account.modelHistory30d
  monthCostRecords.value = props.account.modelCostHistory30d
})

const isCurrentMonth = computed(() => {
  const n = new Date()
  return selectedYear.value === n.getFullYear() && selectedMonth.value === n.getMonth() + 1
})

const monthLabel = computed(() => {
  return `${selectedYear.value}年${String(selectedMonth.value).padStart(2, '0')}月`
})

async function prevMonth() {
  if (selectedMonth.value === 1) {
    selectedMonth.value = 12
    selectedYear.value--
  } else {
    selectedMonth.value--
  }
  await fetchMonthData()
}

async function nextMonth() {
  if (isCurrentMonth.value) return
  if (selectedMonth.value === 12) {
    selectedMonth.value = 1
    selectedYear.value++
  } else {
    selectedMonth.value++
  }
  await fetchMonthData()
}

async function fetchMonthData() {
  if (isCurrentMonth.value) {
    monthRecords.value = props.account.modelHistory30d
    monthCostRecords.value = props.account.modelCostHistory30d
    return
  }
  loading.value = true
  try {
    const result = await window.electronAPI.deepseekFetchMonthUsage(
      props.account.id, selectedYear.value, selectedMonth.value
    )
    monthRecords.value = result?.tokens || []
    monthCostRecords.value = result?.costs || []
  } catch (e) {
    console.warn('[DeepSeekSection] Failed to fetch month data:', e)
    monthRecords.value = []
    monthCostRecords.value = []
  } finally {
    loading.value = false
  }
}

watch(() => props.account.modelHistory30d, (newData) => {
  if (isCurrentMonth.value) {
    monthRecords.value = newData
  }
})

watch(() => props.account.modelCostHistory30d, (newData) => {
  if (isCurrentMonth.value) {
    monthCostRecords.value = newData
  }
})

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return `${n}`
}

function shortModelName(model: string): string {
  return model.replace(/deepseek-/g, '')
}

const baseTooltipOpts = () => ({
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
})

interface DayDetail {
  tokens: number
  requests: number
  cacheHit: number
  cacheMiss: number
  response: number
}

interface ModelGroup {
  name: string
  totalTokens: number
  totalRequests: number
  chartData: { labels: string[]; datasets: any[] }
  dayDetails: Map<string, DayDetail>
}

const modelGroups = computed(() => {
  const year = selectedYear.value
  const month = selectedMonth.value

  const lastDay = new Date(year, month, 0).getDate()
  const monthStr = String(month).padStart(2, '0')

  // Generate all day keys for the month
  const dayKeys: string[] = []
  const dayLabels: string[] = []
  for (let d = 1; d <= lastDay; d++) {
    const ds = String(d).padStart(2, '0')
    dayKeys.push(`${year}-${monthStr}-${ds}`)
    dayLabels.push(ds)
  }

  // Group records by model
  const byModel = new Map<string, Map<string, DayDetail>>()
  for (const r of monthRecords.value) {
    if (!byModel.has(r.model)) byModel.set(r.model, new Map())
    const dayMap = byModel.get(r.model)!
    dayMap.set(r.date, {
      tokens: r.used,
      requests: r.requests ?? 0,
      cacheHit: r.cacheHitTokens ?? 0,
      cacheMiss: r.cacheMissTokens ?? 0,
      response: r.responseTokens ?? 0,
    })
  }

  const groups: ModelGroup[] = []

  // Sort models: v4-pro first, v4-flash second, old models last
  const modelOrder = ['deepseek-v4-pro', 'deepseek-v4-flash']
  const sortedModels = Array.from(byModel.keys()).sort((a, b) => {
    const ai = modelOrder.indexOf(a)
    const bi = modelOrder.indexOf(b)
    if (ai !== -1 && bi !== -1) return ai - bi
    if (ai !== -1) return -1
    if (bi !== -1) return 1
    return a.localeCompare(b)
  })

  for (const model of sortedModels) {
    const dayMap = byModel.get(model)!
    const cacheHitArr = dayKeys.map(k => dayMap.get(k)?.cacheHit ?? 0)
    const cacheMissArr = dayKeys.map(k => dayMap.get(k)?.cacheMiss ?? 0)
    const responseArr = dayKeys.map(k => dayMap.get(k)?.response ?? 0)
    const requestsArr = dayKeys.map(k => dayMap.get(k)?.requests ?? 0)
    const totalTokens = cacheHitArr.reduce((a, b) => a + b, 0)
      + cacheMissArr.reduce((a, b) => a + b, 0)
      + responseArr.reduce((a, b) => a + b, 0)
    const detailMap = new Map<string, DayDetail>()
    for (const [k, v] of dayMap) detailMap.set(k, v)

    groups.push({
      name: shortModelName(model),
      totalTokens,
      totalRequests: requestsArr.reduce((a, b) => a + b, 0),
      dayDetails: detailMap,
      chartData: {
        labels: dayLabels,
        datasets: [
          {
            type: 'bar' as const,
            label: t('main.ttCacheHit'),
            data: cacheHitArr,
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
            data: cacheMissArr,
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
            data: responseArr,
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
            data: requestsArr,
            borderColor: 'rgba(16, 185, 129, 0.45)',
            backgroundColor: 'rgba(16, 185, 129, 0.15)',
            pointRadius: 0,
            pointHoverRadius: 0,
            pointBackgroundColor: 'rgba(16, 185, 129, 0.45)',
            borderWidth: 1.5,
            borderDash: [4, 3],
            tension: 0.3,
            fill: false,
            yAxisID: 'y1',
            order: 1,
          },
        ],
      },
    })
  }

  return groups
})

function getChartOpts(group: ModelGroup) {
  const y = selectedYear.value
  const m = selectedMonth.value
  const lastDay = new Date(y, m, 0).getDate()
  const monthStr = String(m).padStart(2, '0')
  const dayKeys: string[] = []
  for (let d = 1; d <= lastDay; d++) {
    dayKeys.push(`${y}-${monthStr}-${String(d).padStart(2, '0')}`)
  }

  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index' as const, intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        ...baseTooltipOpts(),
        itemSort: (a: any, b: any) => a.datasetIndex - b.datasetIndex,
        callbacks: {
          title(items: any) {
            const idx = items[0]?.dataIndex
            if (idx == null) return ''
            const dayKey = dayKeys[idx]
            const detail = group.dayDetails.get(dayKey)
            const total = (detail?.cacheHit ?? 0) + (detail?.cacheMiss ?? 0) + (detail?.response ?? 0)
            return `${dayKey}    ${formatCount(total)}`
          },
          label(ctx: any) {
            if (ctx.dataset.type === 'line') return null
            return `${ctx.dataset.label}: ${formatCount(ctx.raw)}`
          },
          footer(items: any[]) {
            const idx = items[0]?.dataIndex
            const dayKey = idx != null ? dayKeys[idx] : ''
            const detail = group.dayDetails.get(dayKey)
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
        position: 'right' as const,
        stacked: false,
        ticks: { color: isDark.value ? '#4a7a5e' : '#6da882', font: { size: 8 }, maxTicksLimit: 4 },
        grid: { display: false },
        border: { display: false },
      },
    },
    layout: { padding: { top: 2, bottom: 0, left: 0, right: 0 } },
  }
}

const totalBalance = computed(() => {
  const q = props.account.quotas.find(q => q.label === 'quota.deepseekTotalBalance')
  return q?.total ?? 0
})

const hasBudget = computed(() => budget.value != null && budget.value > 0)

const budgetRate = computed(() => {
  if (!budget.value || budget.value <= 0) return 0
  return Math.min(100, Math.round((totalBalance.value / budget.value) * 100))
})

const budgetRemaining = computed(() => {
  if (!budget.value) return 0
  return Math.max(0, budget.value - totalBalance.value)
})

const barColor = computed(() => {
  const r = budgetRate.value
  if (r > 50) return 'green'
  if (r > 20) return 'yellow'
  return 'red'
})

const details = computed(() => {
  return props.account.quotas
    .filter(q => q.label !== 'quota.deepseekTotalBalance')
    .map(q => ({ label: q.label, amount: q.total.toFixed(2) }))
})

const hasDetails = computed(() => details.value.length > 0)

const hasModelHistory = computed(() =>
  props.account.modelHistory1d.length > 0 ||
  props.account.modelHistory7d.length > 0 ||
  props.account.modelHistory30d.length > 0
)

const COST_MODEL_COLORS: Record<string, string> = {
  pro: '#FFA10A',
  flash: '#FFC104',
  chat: '#FFDC0A',
  reasoner: '#FFDC0A',
}

function getCostModelColor(model: string): string {
  const lower = model.toLowerCase()
  for (const [key, color] of Object.entries(COST_MODEL_COLORS)) {
    if (lower.includes(key)) return color
  }
  return '#FFDC0A'
}

const hasCostData = computed(() => monthCostRecords.value.length > 0)

const costChartData = computed(() => {
  const year = selectedYear.value
  const month = selectedMonth.value
  const lastDay = new Date(year, month, 0).getDate()
  const monthStr = String(month).padStart(2, '0')

  const dayLabels: string[] = []
  const dayKeys: string[] = []
  for (let d = 1; d <= lastDay; d++) {
    dayLabels.push(String(d).padStart(2, '0'))
    dayKeys.push(`${year}-${monthStr}-${String(d).padStart(2, '0')}`)
  }

  // Group costs by model
  const byModel = new Map<string, Map<string, number>>()
  for (const r of monthCostRecords.value) {
    if (!byModel.has(r.model)) byModel.set(r.model, new Map())
    byModel.get(r.model)!.set(r.date, r.cost)
  }

  const datasets = Array.from(byModel.entries()).map(([model, dayMap]) => ({
    label: shortModelName(model),
    data: dayKeys.map(k => dayMap.get(k) ?? 0),
    backgroundColor: getCostModelColor(model),
    borderRadius: 2,
    borderSkipped: false,
  }))

  return { labels: dayLabels, datasets }
})

const costChartOpts = computed(() => ({
  responsive: true,
  maintainAspectRatio: false,
  interaction: { mode: 'index' as const, intersect: false },
  plugins: {
    legend: {
      display: true,
      position: 'bottom' as const,
      labels: {
        boxWidth: 8,
        boxHeight: 8,
        padding: 8,
        font: { size: 10 },
        color: isDark.value ? '#999' : '#666',
        usePointStyle: true,
        pointStyle: 'rectRounded',
      },
    },
    tooltip: {
      ...baseTooltipOpts(),
      callbacks: {
        label: (ctx: any) => `${ctx.dataset.label}: ¥${(ctx.raw as number).toFixed(4)}`,
        footer: (items: any[]) => {
          const total = items.reduce((s: number, i: any) => s + (i.raw as number), 0)
          return `合计: ¥${total.toFixed(4)}`
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
      ticks: {
        color: isDark.value ? '#666' : '#999',
        font: { size: 8 },
        callback: (v: any) => '¥' + Number(v).toFixed(2),
        maxTicksLimit: 4,
      },
      grid: { color: isDark.value ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)' },
      border: { display: false },
    },
  },
  layout: { padding: { top: 2, bottom: 0, left: 0, right: 0 } },
}))

async function onBudgetChange(e: Event) {
  const input = e.target as HTMLInputElement
  const raw = input.value.trim()
  const val = raw ? parseFloat(raw) : undefined
  budget.value = val && val > 0 ? val : undefined
  input.value = budget.value != null ? String(budget.value) : ''

  const config = await window.electronAPI.getConfig()
  if (!config) return
  const providers = { ...config.providers }
  const ds = { ...providers.deepseek }
  const accounts = [...(ds.accounts || [])]
  const idx = accounts.findIndex((a: any) => a.id === props.account.id)
  if (idx >= 0) {
    accounts[idx] = { ...accounts[idx], budget: budget.value }
  }
  ds.accounts = accounts
  providers.deepseek = ds
  await window.electronAPI.updateConfig({ providers })
}
</script>

<style scoped>
.balance-card {
  padding: 8px 10px;
  background: var(--bg-card);
  border-radius: 8px;
  box-shadow: var(--shadow-card);
  transition: background 0.2s, box-shadow 0.2s;
}

.balance-card:hover {
  background: var(--bg-card-hover);
  box-shadow: var(--shadow-card-hover);
}

.balance-header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
}

.balance-label {
  font-weight: 600;
  font-size: 13px;
  color: var(--text-heading);
}

.balance-value {
  font-weight: 700;
  font-size: 20px;
  font-variant-numeric: tabular-nums;
  color: var(--text-primary);
}

.balance-details {
  display: flex;
  gap: 12px;
  margin-top: 6px;
}

.detail-item {
  font-size: 11px;
  color: var(--text-tertiary);
}

.progress-bar {
  height: 6px;
  background: var(--border-subtle);
  border-radius: 3px;
  overflow: hidden;
  margin-top: 8px;
}

.progress-fill {
  height: 100%;
  border-radius: 3px;
  transition: width 0.5s cubic-bezier(0.4, 0, 0.2, 1);
}

.progress-fill.green { background: linear-gradient(90deg, #4ade80, #22c55e); }
.progress-fill.yellow { background: linear-gradient(90deg, #facc15, #eab308); }
.progress-fill.red { background: linear-gradient(90deg, #f87171, #ef4444); }

.budget-info {
  display: flex;
  justify-content: flex-end;
  margin-top: 4px;
}

.budget-hint {
  font-size: 10px;
  color: var(--text-tertiary);
}

.budget-set-row {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--border-subtle);
}

.budget-set-label {
  font-size: 11px;
  color: var(--text-tertiary);
}

.budget-inline-input {
  flex: 1;
  padding: 2px 4px;
  font-size: 11px;
  color: var(--text-secondary);
  background: transparent;
  border: none;
  border-bottom: 1px dashed var(--border-subtle);
  border-radius: 0;
  outline: none;
  font-variant-numeric: tabular-nums;
  transition: border-color 0.15s;
}

.budget-inline-input::placeholder {
  color: var(--text-tertiary);
  font-size: 10px;
}

.budget-inline-input:focus {
  border-bottom-color: var(--border-default);
  border-bottom-style: solid;
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
  gap: 4px;
}

.month-arrow {
  background: none;
  border: 1px solid var(--border-tab);
  border-radius: 4px;
  padding: 1px 5px;
  font-size: 10px;
  color: var(--text-tertiary);
  cursor: pointer;
  transition: all 0.15s;
  line-height: 1.4;
}

.month-arrow:hover:not(:disabled) { color: var(--text-secondary); border-color: var(--border-tab-hover); }
.month-arrow:disabled { opacity: 0.3; cursor: default; }

.month-label {
  font-size: 11px;
  font-weight: 500;
  color: var(--text-secondary);
  min-width: 70px;
  text-align: center;
  font-variant-numeric: tabular-nums;
}

.chart-loading {
  text-align: center;
  font-size: 12px;
  color: var(--text-tertiary);
  padding: 20px 0;
  letter-spacing: 3px;
}

.model-chart-card {
  padding: 6px 0;
}

.model-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
}

.model-name {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-heading);
}

.model-summary {
  display: flex;
  align-items: center;
  gap: 4px;
}

.model-stat {
  font-size: 10px;
  color: var(--text-tertiary);
  font-variant-numeric: tabular-nums;
}

.model-stat-sep {
  font-size: 10px;
  color: var(--text-tertiary);
  opacity: 0.5;
}

.model-chart-wrapper {
  height: 120px;
  width: 100%;
}

.no-data {
  text-align: center;
  font-size: 11px;
  color: var(--text-tertiary);
  padding: 16px 0;
}

.cost-chart-wrapper {
  height: 120px;
  width: 100%;
  margin-bottom: 6px;
}
</style>
