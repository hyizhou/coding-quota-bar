<template>
  <div class="usage-stats">
    <div class="stats-header">
      <div class="stats-left">
        <span class="stats-title">{{ title }}</span>
        <span class="stats-total">{{ formatCount(totalUsed) }}</span>
      </div>
      <div class="stats-tabs">
        <button
          v-for="tab in tabs"
          :key="tab.value"
          class="tab-btn"
          :class="{ active: activeTab === tab.value }"
          @click="activeTab = tab.value"
        >{{ tab.label }}</button>
      </div>
    </div>
    <div class="chart-wrapper">
      <Bar :data="barData" :options="chartOptions" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { Bar } from 'vue-chartjs'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip
} from 'chart.js'
import type { UsageRecord } from '../types'

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip)

const props = defineProps<{
  title: string
  records1d: UsageRecord[]
  records7d: UsageRecord[]
  records30d: UsageRecord[]
  total1d: number
  total7d: number
  total30d: number
}>()

type TabValue = '1d' | '7d' | '30d'

const activeTab = ref<TabValue>('7d')

const tabs = [
  { label: '1天', value: '1d' as TabValue },
  { label: '7天', value: '7d' as TabValue },
  { label: '30天', value: '30d' as TabValue }
]

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
  // 建立 map（key 为本地 YYYY-MM-DDTHH）
  const map = new Map<string, number>()
  for (const r of records) {
    if (r.date.length === 13) map.set(r.date, (map.get(r.date) || 0) + r.used)
  }

  const now = new Date()
  const labels: string[] = []
  const values: number[] = []
  // 从24小时前到当前小时，逐小时
  for (let i = 23; i >= 0; i--) {
    const t = new Date(now.getTime() - i * 3600000)
    t.setMinutes(0, 0, 0)
    const key = localHourStr(t)
    labels.push(`${String(t.getHours()).padStart(2, '0')}:00`)
    values.push(map.get(key) || 0)
  }
  return { labels, values }
}

/** 按7天：7x24小时，每个bar=6小时 */
function aggregate7d(records: UsageRecord[]): { labels: string[]; values: number[] } {
  const now = new Date()
  const msPerHour = 3600000
  const startHour = new Date(now.getTime() - 7 * 86400000)
  startHour.setMinutes(0, 0, 0)

  // 建立查找 map（key 为本地时间 YYYY-MM-DDTHH）
  const map = new Map<string, number>()
  for (const r of records) {
    if (r.date.length === 13) {
      map.set(r.date, (map.get(r.date) || 0) + r.used)
    }
  }

  const labels: string[] = []
  const values: number[] = []
  const bucketSize = 6
  for (let t = startHour.getTime(); t <= now.getTime(); t += msPerHour * bucketSize) {
    let sum = 0
    for (let b = 0; b < bucketSize; b++) {
      const bt = t + b * msPerHour
      if (bt > now.getTime()) break
      sum += map.get(localHourStr(new Date(bt))) || 0
    }
    const d = new Date(t)
    labels.push(`${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getDate().toString().padStart(2, '0')} ${d.getHours().toString().padStart(2, '0')}h`)
    values.push(sum)
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
    labels.push(key.slice(5)) // MM-DD
    values.push(buckets.get(key) || 0)
  }
  return { labels, values }
}

const aggregated = computed(() => {
  if (activeTab.value === '1d') {
    if (!props.records1d.length) return { labels: [] as string[], values: [] as number[] }
    return aggregate1d(props.records1d)
  }
  if (activeTab.value === '7d') {
    if (!props.records7d.length) return { labels: [] as string[], values: [] as number[] }
    return aggregate7d(props.records7d)
  }
  if (!props.records30d.length) return { labels: [] as string[], values: [] as number[] }
  return aggregate30d(props.records30d)
})

const totalUsed = computed(() =>
  activeTab.value === '1d' ? props.total1d
    : activeTab.value === '7d' ? props.total7d
    : props.total30d
)

const barData = computed(() => ({
  labels: aggregated.value.labels,
  datasets: [{
    data: aggregated.value.values,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    hoverBackgroundColor: 'rgba(0, 0, 0, 0.9)',
    borderRadius: 2,
    borderSkipped: false
  }]
}))

const chartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { display: false },
    tooltip: {
      backgroundColor: 'rgba(0, 0, 0, 0.8)',
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
        font: { size: 9 },
        callback: (v: number) => formatCount(v),
        maxTicksLimit: 4
      },
      grid: { color: 'rgba(0, 0, 0, 0.06)' },
      border: { display: false }
    }
  },
  layout: {
    padding: { top: 4, bottom: 0, left: 0, right: 4 }
  }
}
</script>

<style scoped>
.usage-stats {
  margin-top: 8px;
}

.stats-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
}

.stats-left {
  display: flex;
  align-items: baseline;
  gap: 6px;
}

.stats-title {
  font-size: 10px;
  font-weight: 600;
  color: #999;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.stats-total {
  font-size: 11px;
  font-weight: 600;
  color: #333;
  font-variant-numeric: tabular-nums;
}

.stats-tabs {
  display: flex;
  gap: 2px;
}

.tab-btn {
  background: none;
  border: 1px solid rgba(0, 0, 0, 0.1);
  border-radius: 4px;
  padding: 1px 6px;
  font-size: 10px;
  color: #999;
  cursor: pointer;
  transition: all 0.15s;
  line-height: 1.4;
}

.tab-btn:hover { color: #666; border-color: rgba(0, 0, 0, 0.2); }
.tab-btn.active {
  background: #333;
  color: #fff;
  border-color: #333;
}

.chart-wrapper {
  height: 100px;
  width: 100%;
}
</style>
