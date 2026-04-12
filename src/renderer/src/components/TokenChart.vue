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
import type { UsageRecord } from '../types'
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
  records1d: UsageRecord[]
  records7d: UsageRecord[]
  records30d: UsageRecord[]
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

/** 按1天：过去24小时，每个bar=1小时 */
function aggregate1d(records: UsageRecord[]): { labels: string[]; values: number[] } {
  const map = new Map<string, number>()
  for (const r of records) {
    if (r.date.length === 13) map.set(r.date, (map.get(r.date) || 0) + r.used)
  }

  const now = new Date()
  const labels: string[] = []
  const values: number[] = []
  for (let i = 23; i >= 0; i--) {
    const t = new Date(now.getTime() - i * 3600000)
    t.setMinutes(0, 0, 0)
    const key = localHourStr(t)
    labels.push(`${String(t.getHours()).padStart(2, '0')}:00`)
    values.push(map.get(key) || 0)
  }
  return { labels, values }
}

/** 按7天：每小时一个bar */
function aggregate7d(records: UsageRecord[]): { labels: string[]; values: number[] } {
  const now = new Date()
  const startHour = new Date(now.getTime() - 7 * 86400000)
  startHour.setMinutes(0, 0, 0)

  const map = new Map<string, number>()
  for (const r of records) {
    if (r.date.length === 13) {
      map.set(r.date, (map.get(r.date) || 0) + r.used)
    }
  }

  const labels: string[] = []
  const values: number[] = []
  for (let t = startHour.getTime(); t <= now.getTime(); t += 3600000) {
    const d = new Date(t)
    labels.push(`${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getDate().toString().padStart(2, '0')} ${d.getHours().toString().padStart(2, '0')}:00`)
    values.push(map.get(localHourStr(d)) || 0)
  }
  return { labels, values }
}

/** 按30天：每个bar=1天 */
function aggregate30d(records: UsageRecord[]): { labels: string[]; values: number[] } {
  const buckets = new Map<string, number>()
  for (const r of records) {
    const day = r.date.slice(0, 10)
    buckets.set(day, (buckets.get(day) || 0) + r.used)
  }

  const now = new Date()
  const labels: string[] = []
  const values: number[] = []
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 86400000)
    const key = localDateStr(d)
    labels.push(key.slice(5))
    values.push(buckets.get(key) || 0)
  }
  return { labels, values }
}

const aggregated = computed(() => {
  if (props.activeTab === '1d') {
    if (!props.records1d.length) return { labels: [] as string[], values: [] as number[] }
    return aggregate1d(props.records1d)
  }
  if (props.activeTab === '7d') {
    if (!props.records7d.length) return { labels: [] as string[], values: [] as number[] }
    return aggregate7d(props.records7d)
  }
  if (!props.records30d.length) return { labels: [] as string[], values: [] as number[] }
  return aggregate30d(props.records30d)
})

const totalUsed = computed(() =>
  aggregated.value.values.reduce((sum, v) => sum + v, 0)
)

const barData = computed(() => ({
  labels: aggregated.value.labels,
  datasets: [{
    data: aggregated.value.values,
    backgroundColor: isDark.value ? 'rgba(255, 255, 255, 0.55)' : 'rgba(0, 0, 0, 0.65)',
    hoverBackgroundColor: isDark.value ? 'rgba(255, 255, 255, 0.8)' : 'rgba(0, 0, 0, 0.9)',
    borderRadius: 2,
    borderSkipped: false
  }]
}))

const chartOptions = computed(() => ({
  responsive: true,
  maintainAspectRatio: false,
  interaction: {
    mode: 'index' as const,
    intersect: false
  },
  plugins: {
    legend: { display: false },
    tooltip: {
      backgroundColor: isDark.value ? 'rgba(40, 40, 40, 0.9)' : 'rgba(0, 0, 0, 0.8)',
      titleColor: isDark.value ? '#e0e0e0' : '#fff',
      bodyColor: isDark.value ? '#ccc' : '#fff',
      titleFont: { size: 11 },
      bodyFont: { size: 11 },
      padding: { top: 4, bottom: 4, left: 8, right: 8 },
      cornerRadius: 4,
      displayColors: false,
      callbacks: {
        label: (ctx: { parsed: { y: number } }) => formatCount(ctx.parsed.y)
      }
    }
  },
  scales: {
    x: {
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
