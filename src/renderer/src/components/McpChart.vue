<template>
  <div class="mcp-chart">
    <div class="chart-header">
      <div class="chart-left">
        <span class="chart-title">{{ title }}</span>
        <span class="chart-total">{{ totalCount }}次</span>
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
import type { McpUsageRecord } from '../types'
import { useTheme } from '../composables/useTheme'

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip)

const { isDark } = useTheme()

const props = defineProps<{
  title: string
  records1d: McpUsageRecord[]
  records7d: McpUsageRecord[]
  records30d: McpUsageRecord[]
  activeTab: '1d' | '7d' | '30d'
}>()

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

interface AggregatedMcp { labels: string[]; search: number[]; webRead: number[]; zread: number[] }

/** 按1天：过去24小时，每个bar=1小时 */
function aggregate1d(records: McpUsageRecord[]): AggregatedMcp {
  const searchMap = new Map<string, number>()
  const webReadMap = new Map<string, number>()
  const zreadMap = new Map<string, number>()
  for (const r of records) {
    if (r.date.length === 13) {
      searchMap.set(r.date, (searchMap.get(r.date) || 0) + r.search)
      webReadMap.set(r.date, (webReadMap.get(r.date) || 0) + r.webRead)
      zreadMap.set(r.date, (zreadMap.get(r.date) || 0) + r.zread)
    }
  }

  const now = new Date()
  const labels: string[] = []
  const search: number[] = []
  const webRead: number[] = []
  const zread: number[] = []
  for (let i = 23; i >= 0; i--) {
    const t = new Date(now.getTime() - i * 3600000)
    t.setMinutes(0, 0, 0)
    const key = localHourStr(t)
    labels.push(`${String(t.getHours()).padStart(2, '0')}:00`)
    search.push(searchMap.get(key) || 0)
    webRead.push(webReadMap.get(key) || 0)
    zread.push(zreadMap.get(key) || 0)
  }
  return { labels, search, webRead, zread }
}

/** 按7天：每小时一个bar */
function aggregate7d(records: McpUsageRecord[]): AggregatedMcp {
  const now = new Date()
  const startHour = new Date(now.getTime() - 7 * 86400000)
  startHour.setMinutes(0, 0, 0)

  const searchMap = new Map<string, number>()
  const webReadMap = new Map<string, number>()
  const zreadMap = new Map<string, number>()
  for (const r of records) {
    if (r.date.length === 13) {
      searchMap.set(r.date, (searchMap.get(r.date) || 0) + r.search)
      webReadMap.set(r.date, (webReadMap.get(r.date) || 0) + r.webRead)
      zreadMap.set(r.date, (zreadMap.get(r.date) || 0) + r.zread)
    }
  }

  const labels: string[] = []
  const search: number[] = []
  const webRead: number[] = []
  const zread: number[] = []
  for (let t = startHour.getTime(); t <= now.getTime(); t += 3600000) {
    const d = new Date(t)
    labels.push(`${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getDate().toString().padStart(2, '0')} ${d.getHours().toString().padStart(2, '0')}:00`)
    search.push(searchMap.get(localHourStr(d)) || 0)
    webRead.push(webReadMap.get(localHourStr(d)) || 0)
    zread.push(zreadMap.get(localHourStr(d)) || 0)
  }
  return { labels, search, webRead, zread }
}

/** 按30天：每个bar=1天 */
function aggregate30d(records: McpUsageRecord[]): AggregatedMcp {
  const searchBuckets = new Map<string, number>()
  const webReadBuckets = new Map<string, number>()
  const zreadBuckets = new Map<string, number>()
  for (const r of records) {
    const day = r.date.slice(0, 10)
    searchBuckets.set(day, (searchBuckets.get(day) || 0) + r.search)
    webReadBuckets.set(day, (webReadBuckets.get(day) || 0) + r.webRead)
    zreadBuckets.set(day, (zreadBuckets.get(day) || 0) + r.zread)
  }

  const now = new Date()
  const labels: string[] = []
  const search: number[] = []
  const webRead: number[] = []
  const zread: number[] = []
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 86400000)
    const key = localDateStr(d)
    labels.push(key.slice(5))
    search.push(searchBuckets.get(key) || 0)
    webRead.push(webReadBuckets.get(key) || 0)
    zread.push(zreadBuckets.get(key) || 0)
  }
  return { labels, search, webRead, zread }
}

const aggregated = computed(() => {
  if (props.activeTab === '1d') {
    if (!props.records1d.length) return { labels: [] as string[], search: [] as number[], webRead: [] as number[], zread: [] as number[] }
    return aggregate1d(props.records1d)
  }
  if (props.activeTab === '7d') {
    if (!props.records7d.length) return { labels: [] as string[], search: [] as number[], webRead: [] as number[], zread: [] as number[] }
    return aggregate7d(props.records7d)
  }
  if (!props.records30d.length) return { labels: [] as string[], search: [] as number[], webRead: [] as number[], zread: [] as number[] }
  return aggregate30d(props.records30d)
})

const totalCount = computed(() => {
  const a = aggregated.value
  let sum = 0
  for (let i = 0; i < a.labels.length; i++) {
    sum += a.search[i] + a.webRead[i] + a.zread[i]
  }
  return sum
})

const COLORS = {
  search: { bg: 'rgba(59, 130, 246, 0.7)', hover: 'rgba(59, 130, 246, 0.9)' },
  webRead: { bg: 'rgba(16, 185, 129, 0.7)', hover: 'rgba(16, 185, 129, 0.9)' },
  zread: { bg: 'rgba(245, 158, 11, 0.7)', hover: 'rgba(245, 158, 11, 0.9)' },
}

const barData = computed(() => ({
  labels: aggregated.value.labels,
  datasets: [
    {
      label: '搜索',
      data: aggregated.value.search,
      backgroundColor: COLORS.search.bg,
      hoverBackgroundColor: COLORS.search.hover,
      borderRadius: 2,
      borderSkipped: false
    },
    {
      label: '阅读',
      data: aggregated.value.webRead,
      backgroundColor: COLORS.webRead.bg,
      hoverBackgroundColor: COLORS.webRead.hover,
      borderRadius: 2,
      borderSkipped: false
    },
    {
      label: 'ZRead',
      data: aggregated.value.zread,
      backgroundColor: COLORS.zread.bg,
      hoverBackgroundColor: COLORS.zread.hover,
      borderRadius: 2,
      borderSkipped: false
    }
  ]
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
      boxHeight: 8
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
.mcp-chart .chart-wrapper {
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
