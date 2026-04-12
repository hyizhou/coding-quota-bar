<template>
  <div class="quota-card">
    <div class="card-top">
      <span class="quota-label">{{ $t(label, labelParams) }}</span>
      <span class="quota-percent" :class="color">{{ usageRate.toFixed(1) }}%</span>
    </div>
    <div class="progress-bar">
      <div class="progress-fill" :class="color" :style="{ width: usageRate + '%' }"></div>
    </div>
    <div class="card-bottom">
      <span class="reset-text">{{ formatReset(resetAt) }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'

defineProps<{
  label: string
  labelParams?: Record<string, string | number>
  usageRate: number
  resetAt: string
  color: 'green' | 'yellow' | 'red'
}>()

const { t, locale } = useI18n()

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
</script>

<style scoped>
.quota-card {
  padding: 8px 10px;
  background: var(--bg-card);
  border-radius: 10px;
  box-shadow: var(--shadow-card);
  transition: background 0.2s, box-shadow 0.2s;
}

.quota-card:hover {
  background: var(--bg-card-hover);
  box-shadow: var(--shadow-card-hover);
}

.card-top {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 5px;
}

.quota-label {
  font-weight: 600;
  font-size: 13px;
  color: var(--text-heading);
}

.quota-percent {
  font-weight: 700;
  font-size: 16px;
  font-variant-numeric: tabular-nums;
  color: var(--text-primary);
}
.quota-percent.yellow { color: #a16207; }
.quota-percent.red { color: #dc2626; }

.progress-bar {
  height: 6px;
  background: var(--border-subtle);
  border-radius: 3px;
  overflow: hidden;
  margin-bottom: 5px;
}

.progress-fill {
  height: 100%;
  border-radius: 3px;
  transition: width 0.5s cubic-bezier(0.4, 0, 0.2, 1);
}
.progress-fill.green { background: linear-gradient(90deg, #4ade80, #22c55e); }
.progress-fill.yellow { background: linear-gradient(90deg, #facc15, #eab308); }
.progress-fill.red { background: linear-gradient(90deg, #f87171, #ef4444); }

.card-bottom {
  display: flex;
  justify-content: flex-end;
}

.reset-text {
  font-size: 10px;
  color: var(--text-tertiary);
}

</style>
