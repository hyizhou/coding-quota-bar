<template>
  <div class="performance-chart">
    <div class="stats-tabs-row">
      <span class="chart-title">{{ $t('main.performanceStats') }}</span>
      <div class="stats-time-tabs">
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
      <Line :data="lineData" :options="chartOptions" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Line } from 'vue-chartjs'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip
} from 'chart.js'
import type { PerformanceRecord } from '../types'
import { useTheme } from '../composables/useTheme'

ChartJS.register(CategoryScale, LinearScale, LineElement, PointElement, Tooltip)

const { t } = useI18n()
const { isDark } = useTheme()

const props = defineProps<{
  records7d: PerformanceRecord[]
  records15d: PerformanceRecord[]
  records30d: PerformanceRecord[]
}>()

type TabValue = '7d' | '15d' | '30d'
const activeTab = ref<TabValue>('7d')

const tabs = [
  { label: t('main.tab7d'), value: '7d' as TabValue },
  { label: t('main.tab15d'), value: '15d' as TabValue },
  { label: t('main.tab30d'), value: '30d' as TabValue }
]

const records = computed(() => {
  if (activeTab.value === '7d') return props.records7d
  if (activeTab.value === '15d') return props.records15d
  return props.records30d
})

const lineData = computed(() => {
  const r = records.value
  return {
    labels: r.map(v => v.date.slice(5)),
    datasets: [
      {
        label: t('main.perfProMax'),
        data: r.map(v => v.proMaxDecodeSpeed),
        borderColor: 'rgba(16, 185, 129, 0.9)',
        backgroundColor: 'rgba(16, 185, 129, 0.1)',
        tension: 0.4,
        borderWidth: 2,
        pointRadius: 0,
        pointHoverRadius: 3,
      },
      {
        label: t('main.perfLite'),
        data: r.map(v => v.liteDecodeSpeed),
        borderColor: 'rgba(59, 130, 246, 0.9)',
        backgroundColor: 'rgba(59, 130, 246, 0.1)',
        tension: 0.4,
        borderWidth: 2,
        pointRadius: 0,
        pointHoverRadius: 3,
      }
    ]
  }
})

const chartOptions = computed(() => {
  const r = records.value
  // 根据数据动态计算 Y 轴范围
  let yMin = 0, yMax = 100
  if (r.length) {
    const speeds = r.flatMap(v => [v.liteDecodeSpeed, v.proMaxDecodeSpeed]).filter(v => v > 0)
    if (speeds.length) {
      const dataMin = Math.min(...speeds)
      const dataMax = Math.max(...speeds)
      const padding = (dataMax - dataMin) * 0.15 || 5
      yMin = 0
      yMax = Math.ceil(dataMax + padding)
    }
  }
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index' as const, intersect: false },
    plugins: {
      legend: {
        display: true,
        position: 'bottom' as const,
        labels: {
          boxWidth: 8, boxHeight: 8, padding: 6,
          font: { size: 8 },
          color: isDark.value ? '#999' : '#666',
          usePointStyle: true,
          pointStyle: 'circle' as const
        }
      },
      tooltip: {
        backgroundColor: isDark.value ? 'rgba(40,40,40,0.9)' : 'rgba(0,0,0,0.8)',
        titleColor: isDark.value ? '#e0e0e0' : '#fff',
        bodyColor: isDark.value ? '#ccc' : '#fff',
        titleFont: { size: 11 }, bodyFont: { size: 11 },
        padding: { top: 4, bottom: 4, left: 8, right: 8 },
        cornerRadius: 4,
        displayColors: true, boxWidth: 8, boxHeight: 8,
        callbacks: {
          afterBody: (items: { dataIndex: number }[]) => {
            const idx = items[0]?.dataIndex
            if (idx == null || !r[idx]) return ''
            const d = r[idx]
            return [
              `Pro/Max ${t('main.perfRate')}: ${(d.proMaxSuccessRate * 100).toFixed(2)}%`,
              `Lite ${t('main.perfRate')}: ${(d.liteSuccessRate * 100).toFixed(2)}%`
            ]
          }
        }
      }
    },
    scales: {
      x: {
        ticks: { color: isDark.value ? '#666' : '#999', font: { size: 8 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 8 },
        grid: { display: false }, border: { display: false }
      },
      y: {
        min: yMin, max: yMax,
        ticks: { color: isDark.value ? '#666' : '#999', font: { size: 8 }, maxTicksLimit: 4, callback: (v: number) => v.toFixed(0) },
        grid: { color: isDark.value ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)' },
        border: { display: false }
      }
    },
    layout: { padding: { top: 4, bottom: 0, left: 0, right: 4 } }
  }
})
</script>

<style scoped>
.performance-chart {
  margin-top: 13px;
}

.stats-tabs-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
}

.chart-title {
  font-size: 10px;
  font-weight: 600;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.stats-time-tabs {
  display: flex;
  gap: 2px;
}

.tab-btn {
  background: none;
  border: 1px solid var(--border-tab);
  border-radius: 4px;
  padding: 1px 6px;
  font-size: 10px;
  color: var(--text-tertiary);
  cursor: pointer;
  transition: all 0.15s;
  line-height: 1.4;
}

.tab-btn:hover { color: var(--text-secondary); border-color: var(--border-tab-hover); }
.tab-btn.active {
  background: var(--bg-toggle-active);
  color: var(--bg-input);
  border-color: var(--bg-toggle-active);
}

.chart-wrapper {
  height: 100px;
  width: 100%;
}
</style>
