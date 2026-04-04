<template>
  <div class="chart-wrapper">
    <Bar :data="chartData" :options="chartOptions" />
  </div>
</template>

<script setup lang="ts">
import { Bar } from 'vue-chartjs'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip
} from 'chart.js'
import { useI18n } from 'vue-i18n'

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip)

const { t } = useI18n()

const props = defineProps<{
  chartData: {
    labels: string[]
    datasets: {
      label: string
      data: number[]
      backgroundColor: string | string[]
      borderColor?: string
      borderWidth?: number
      borderRadius?: number
    }[]
  }
}>()

const chartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { display: false },
    tooltip: {
      callbacks: {
        label: (ctx: { parsed: { y: number } }) =>
          `${ctx.parsed.y.toLocaleString()} ${t('chart.tokens')}`
      }
    }
  },
  scales: {
    x: {
      ticks: { font: { size: 9 }, maxRotation: 0 },
      grid: { display: false },
      border: { display: false }
    },
    y: {
      ticks: {
        font: { size: 9 },
        callback: (v: number) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v),
        maxTicksLimit: 4
      },
      grid: { color: 'rgba(0,0,0,0.05)' },
      border: { display: false }
    }
  },
  layout: {
    padding: { top: 4, bottom: 0, left: 0, right: 4 }
  }
}
</script>

<style scoped>
.chart-wrapper {
  height: 110px;
  width: 100%;
}
</style>
