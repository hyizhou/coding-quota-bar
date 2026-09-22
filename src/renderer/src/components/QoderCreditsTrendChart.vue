<!--
  Qoder Credits 日趋势折线图：
  展示账户用量页 daily-trend 接口的 1 / 7 / 30 天消耗、参考费用与消息数。
-->
<template>
  <div class="qoder-trend-card">
    <div class="chart-header">
      <div class="chart-left">
        <span class="chart-title">{{ $t('main.qoderCreditsTrend') }}</span>
        <span class="chart-total">{{ formatCredits(total) }}</span>
      </div>
      <div class="range-tabs">
        <button
          v-for="range in ranges"
          :key="range.value"
          class="range-btn"
          :class="{ active: activeRange === range.value }"
          @click="setRange(range.value)"
        >{{ $t(range.label) }}</button>
      </div>
    </div>
    <div class="chart-wrapper">
      <Line :data="chartData" :options="chartOptions" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { Line } from 'vue-chartjs'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Filler,
  Tooltip
} from 'chart.js'
import { useI18n } from 'vue-i18n'
import type { QoderCreditsTrend } from '../types'
import { useTheme } from '../composables/useTheme'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Filler, Tooltip)

const props = defineProps<{
  trend: QoderCreditsTrend
}>()

const { isDark } = useTheme()
const { t } = useI18n()

type TrendRange = '1d' | '7d' | '30d'
const STORAGE_KEY_RANGE = 'qoder-credits-trend-range'

function restoreRange(): TrendRange {
  try {
    const saved = localStorage.getItem(STORAGE_KEY_RANGE) as TrendRange | null
    if (saved === '1d' || saved === '7d' || saved === '30d') return saved
  } catch {}
  return '7d'
}

const activeRange = ref<TrendRange>(restoreRange())
const ranges = [
  { label: 'main.tab1d', value: '1d' as TrendRange },
  { label: 'main.tab7d', value: '7d' as TrendRange },
  { label: 'main.tab30d', value: '30d' as TrendRange },
]

function setRange(range: TrendRange): void {
  activeRange.value = range
  try { localStorage.setItem(STORAGE_KEY_RANGE, range) } catch {}
}

function formatCredits(value: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value)
}

function formatDateLabel(date: string): string {
  const [year, month, day] = date.split('-').map(Number)
  if (!year || !month || !day) return date
  return `${month}/${day}`
}

const selectedPoints = computed(() => {
  if (activeRange.value === '1d') return props.trend.points.slice(-1)
  if (activeRange.value === '7d') return props.trend.points.slice(-7)
  return props.trend.points.slice(-30)
})

const total = computed(() => selectedPoints.value.reduce((sum, p) => sum + p.credits, 0))

const chartData = computed(() => ({
  labels: selectedPoints.value.map(p => formatDateLabel(p.date)),
  datasets: [{
    label: 'Credits',
    data: selectedPoints.value.map(p => p.credits),
    borderColor: '#22c55e',
    backgroundColor: 'rgba(34, 197, 94, 0.12)',
    fill: true,
    tension: 0.25,
    borderWidth: 1.5,
    pointRadius: 0,
    pointHoverRadius: 3,
    pointBackgroundColor: '#22c55e',
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
        title: (items: Array<{ dataIndex: number }>) => selectedPoints.value[items[0]?.dataIndex]?.date ?? '',
        label: (item: { dataIndex: number }) => {
          const point = selectedPoints.value[item.dataIndex]
          if (!point) return ''
          return [
            `Credits: ${formatCredits(point.credits)}`,
            `${t('main.qoderReferenceCost')}: ${formatCredits(point.referenceCost)}`,
            `${t('main.qoderMessages')}: ${point.messageCount}`
          ]
        }
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
        maxTicksLimit: 7
      },
      grid: { display: false },
      border: { display: false }
    },
    y: {
      beginAtZero: true,
      ticks: {
        color: isDark.value ? '#666' : '#999',
        font: { size: 9 },
        maxTicksLimit: 4,
        callback: (value: string | number) => formatCredits(Number(value))
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
.qoder-trend-card {
  margin-bottom: 6px;
  padding: 6px 10px;
  background: var(--bg-card);
  border-radius: 8px;
  box-shadow: var(--shadow-card);
  transition: background 0.2s, box-shadow 0.2s;
}

.qoder-trend-card:hover {
  background: var(--bg-card-hover);
  box-shadow: var(--shadow-card-hover);
}

.chart-header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 6px;
}

.chart-left {
  display: flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
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

.range-tabs {
  display: flex;
  gap: 2px;
  flex-shrink: 0;
}

.range-btn {
  border: 1px solid var(--border-tab);
  border-radius: 4px;
  background: transparent;
  padding: 1px 5px;
  font-size: 10px;
  line-height: 1.4;
  color: var(--text-tertiary);
  cursor: pointer;
  transition: all 0.15s;
}

.range-btn:hover {
  color: var(--text-secondary);
  border-color: var(--border-tab-hover);
}

.range-btn.active {
  background: var(--bg-toggle-active);
  color: var(--bg-input);
  border-color: var(--bg-toggle-active);
}

.chart-wrapper {
  height: 66px;
  width: 100%;
}
</style>
