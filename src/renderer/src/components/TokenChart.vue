<template>
  <div class="token-chart">
    <div class="chart-header">
      <div class="chart-left">
        <span class="chart-title">{{ title }}</span>
        <span class="chart-total">{{ formatCount(totalUsed) }}</span>
      </div>
    </div>
    <div class="chart-wrapper">
      <Bar :data="barData" :options="chartOptions" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Bar } from 'vue-chartjs'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip
} from 'chart.js'
import type { ModelTokenRecord } from '../types'
import { useTheme } from '../composables/useTheme'

/** 鼠标悬停时绘制垂直辅助线 */
const verticalLinePlugin = {
  id: 'verticalLine',
  afterDraw(chart: import('chart.js').Chart) {
    if (chart.tooltip?.getActiveElements()?.length) {
      const x = chart.tooltip.caretX
      const yAxis = chart.scales.y
      const ctx = chart.ctx
      ctx.save()
      ctx.beginPath()
      ctx.moveTo(x, yAxis.top)
      ctx.lineTo(x, yAxis.bottom)
      ctx.lineWidth = 1
      ctx.strokeStyle = chart.options.color as string || 'rgba(0,0,0,0.15)'
      ctx.setLineDash([4, 3])
      ctx.stroke()
      ctx.restore()
    }
  }
}

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, verticalLinePlugin)

const { isDark } = useTheme()

const props = defineProps<{
  title: string
  modelRecords1d: ModelTokenRecord[]
  modelRecords7d: ModelTokenRecord[]
  modelRecords30d: ModelTokenRecord[]
  activeTab: '1d' | '7d' | '30d'
}>()

function formatCount(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(2)}K`
  return `${n}`
}

/** 本地日期字符串 YYYY-MM-DD */
function localDateStr(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** 本地小时字符串 YYYY-MM-DDTHH */
function localHourStr(d: Date): string {
  return localDateStr(d) + 'T' + String(d.getHours()).padStart(2, '0')
}

/** 模型配色（最多 8 个模型） */
const MODEL_COLORS = [
  { bg: 'rgba(59, 130, 246, 0.7)', hover: 'rgba(59, 130, 246, 0.9)' },   // 蓝
  { bg: 'rgba(16, 185, 129, 0.7)', hover: 'rgba(16, 185, 129, 0.9)' },   // 绿
  { bg: 'rgba(245, 158, 11, 0.7)', hover: 'rgba(245, 158, 11, 0.9)' },   // 橙
  { bg: 'rgba(239, 68, 68, 0.7)', hover: 'rgba(239, 68, 68, 0.9)' },     // 红
  { bg: 'rgba(139, 92, 246, 0.7)', hover: 'rgba(139, 92, 246, 0.9)' },   // 紫
  { bg: 'rgba(236, 72, 153, 0.7)', hover: 'rgba(236, 72, 153, 0.9)' },   // 粉
  { bg: 'rgba(20, 184, 166, 0.7)', hover: 'rgba(20, 184, 166, 0.9)' },   // 青
  { bg: 'rgba(107, 114, 128, 0.7)', hover: 'rgba(107, 114, 128, 0.9)' }, // 灰
]

interface StackedResult { labels: string[]; models: string[]; values: Map<string, number[]> }

/** 按1天：过去24小时 */
function aggregate1dStacked(records: ModelTokenRecord[]): StackedResult {
  const modelSet = new Set<string>()
  // date → model → sum
  const buckets = new Map<string, Map<string, number>>()
  for (const r of records) {
    if (r.date.length !== 13) continue
    modelSet.add(r.model)
    if (!buckets.has(r.date)) buckets.set(r.date, new Map())
    const m = buckets.get(r.date)!
    m.set(r.model, (m.get(r.model) || 0) + r.used)
  }

  const now = new Date()
  const labels: string[] = []
  for (let i = 23; i >= 0; i--) {
    const t = new Date(now.getTime() - i * 3600000)
    t.setMinutes(0, 0, 0)
    labels.push(`${String(t.getHours()).padStart(2, '0')}:00`)
  }

  const models = Array.from(modelSet)
  const values = new Map<string, number[]>()
  for (const model of models) {
    const arr: number[] = []
    for (let i = 23; i >= 0; i--) {
      const t = new Date(now.getTime() - i * 3600000)
      t.setMinutes(0, 0, 0)
      const key = localHourStr(t)
      arr.push(buckets.get(key)?.get(model) || 0)
    }
    values.set(model, arr)
  }
  return { labels, models, values }
}

/** 按7天：每小时一个bar */
function aggregate7dStacked(records: ModelTokenRecord[]): StackedResult {
  const now = new Date()
  const startHour = new Date(now.getTime() - 7 * 86400000)
  startHour.setMinutes(0, 0, 0)

  const modelSet = new Set<string>()
  const buckets = new Map<string, Map<string, number>>()
  for (const r of records) {
    if (r.date.length !== 13) continue
    modelSet.add(r.model)
    if (!buckets.has(r.date)) buckets.set(r.date, new Map())
    const m = buckets.get(r.date)!
    m.set(r.model, (m.get(r.model) || 0) + r.used)
  }

  const labels: string[] = []
  const timeKeys: string[] = []
  for (let t = startHour.getTime(); t <= now.getTime(); t += 3600000) {
    const d = new Date(t)
    labels.push(`${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getDate().toString().padStart(2, '0')} ${d.getHours().toString().padStart(2, '0')}:00`)
    timeKeys.push(localHourStr(d))
  }

  const models = Array.from(modelSet)
  const values = new Map<string, number[]>()
  for (const model of models) {
    values.set(model, timeKeys.map(key => buckets.get(key)?.get(model) || 0))
  }
  return { labels, models, values }
}

/** 按30天：每天一个bar */
function aggregate30dStacked(records: ModelTokenRecord[]): StackedResult {
  const now = new Date()
  const modelSet = new Set<string>()
  const buckets = new Map<string, Map<string, number>>()
  for (const r of records) {
    const day = r.date.slice(0, 10)
    modelSet.add(r.model)
    if (!buckets.has(day)) buckets.set(day, new Map())
    const m = buckets.get(day)!
    m.set(r.model, (m.get(r.model) || 0) + r.used)
  }

  const labels: string[] = []
  const dayKeys: string[] = []
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 86400000)
    const key = localDateStr(d)
    labels.push(key.slice(5))
    dayKeys.push(key)
  }

  const models = Array.from(modelSet)
  const values = new Map<string, number[]>()
  for (const model of models) {
    values.set(model, dayKeys.map(key => buckets.get(key)?.get(model) || 0))
  }
  return { labels, models, values }
}

const stacked = computed(() => {
  if (props.activeTab === '1d') {
    if (!props.modelRecords1d.length) return { labels: [] as string[], models: [] as string[], values: new Map<string, number[]>() }
    return aggregate1dStacked(props.modelRecords1d)
  }
  if (props.activeTab === '7d') {
    if (!props.modelRecords7d.length) return { labels: [] as string[], models: [] as string[], values: new Map<string, number[]>() }
    return aggregate7dStacked(props.modelRecords7d)
  }
  if (!props.modelRecords30d.length) return { labels: [] as string[], models: [] as string[], values: new Map<string, number[]>() }
  return aggregate30dStacked(props.modelRecords30d)
})

const totalUsed = computed(() => {
  let sum = 0
  for (const arr of stacked.value.values.values()) {
    for (const v of arr) sum += v
  }
  return sum
})

const barData = computed(() => ({
  labels: stacked.value.labels,
  datasets: stacked.value.models.map((model, idx) => ({
    label: model,
    data: stacked.value.values.get(model) || [],
    backgroundColor: MODEL_COLORS[idx % MODEL_COLORS.length].bg,
    hoverBackgroundColor: MODEL_COLORS[idx % MODEL_COLORS.length].hover,
    borderRadius: 2,
    borderSkipped: false
  }))
}))

const chartOptions = computed(() => ({
  responsive: true,
  maintainAspectRatio: false,
  interaction: {
    mode: 'index' as const,
    intersect: false
  },
  plugins: {
    legend: {
      display: true,
      position: 'bottom' as const,
      labels: {
        boxWidth: 8,
        boxHeight: 8,
        padding: 8,
        font: { size: 9 },
        color: isDark.value ? '#999' : '#666',
        usePointStyle: true,
        pointStyle: 'rectRounded' as const
      }
    },
    tooltip: {
      backgroundColor: isDark.value ? 'rgba(40, 40, 40, 0.9)' : 'rgba(0, 0, 0, 0.8)',
      titleColor: isDark.value ? '#e0e0e0' : '#fff',
      bodyColor: isDark.value ? '#ccc' : '#fff',
      titleFont: { size: 11 },
      bodyFont: { size: 11 },
      padding: { top: 4, bottom: 4, left: 8, right: 8 },
      cornerRadius: 4,
      displayColors: true,
      boxWidth: 8,
      boxHeight: 8,
      callbacks: {
        label: (ctx: { dataset: { label?: string }; parsed: { y: number } }) =>
          `${ctx.dataset.label}: ${formatCount(ctx.parsed.y)}`
      }
    }
  },
  scales: {
    x: {
      stacked: true,
      ticks: {
        color: isDark.value ? '#666' : '#999',
        font: { size: 8 },
        maxRotation: 0,
        autoSkip: true,
        maxTicksLimit: 12
      },
      grid: { display: false },
      border: { display: false }
    },
    y: {
      stacked: true,
      ticks: {
        color: isDark.value ? '#666' : '#999',
        font: { size: 9 },
        callback: (v: number) => formatCount(v),
        maxTicksLimit: 4
      },
      grid: { color: isDark.value ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.06)' },
      border: { display: false }
    }
  },
  layout: {
    padding: { top: 4, bottom: 0, left: 0, right: 4 }
  }
}))
</script>

<style scoped>
.token-chart .chart-wrapper {
  height: 100px;
  width: 100%;
}

.chart-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
}

.chart-left {
  display: flex;
  align-items: baseline;
  gap: 6px;
}

.chart-title {
  font-size: 10px;
  font-weight: 600;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.chart-total {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
}
</style>
