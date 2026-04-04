<template>
  <div class="provider-card">
    <div class="provider-top">
      <span class="provider-name">{{ name }}</span>
      <span class="provider-percent" :class="color">{{ Math.round(percent) }}%</span>
    </div>
    <div class="progress-bar">
      <div class="progress-fill" :class="color" :style="{ width: Math.round(percent) + '%' }"></div>
    </div>
    <div class="provider-bottom">
      <span class="usage-text">{{ formatNumber(used) }} / {{ formatNumber(total) }}</span>
      <span class="expire-text">{{ formatExpires(expiresAt) }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'

defineProps<{
  name: string
  used: number
  total: number
  percent: number
  color: 'green' | 'yellow' | 'red'
  expiresAt: string
}>()

const { t, locale } = useI18n()

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

function formatExpires(iso: string): string {
  try {
    const d = new Date(iso)
    const diff = Math.ceil((d.getTime() - Date.now()) / 86400000)
    const dateStr = d.toLocaleDateString(locale.value, { month: 'short', day: 'numeric' })
    if (diff < 0) return `${dateStr} (${t('provider.expired')})`
    if (diff === 0) return t('provider.expiresToday')
    if (diff === 1) return t('provider.expiresTomorrow')
    if (diff <= 7) return t('provider.expiresInDays', { n: diff })
    return dateStr
  } catch { return iso }
}
</script>

<style scoped>
.provider-card {
  padding: 8px 10px;
  background: #f8f9fa;
  border-radius: 8px;
  transition: transform 0.15s, box-shadow 0.15s;
}
.provider-card:hover {
  transform: translateY(-1px);
  box-shadow: 0 2px 6px rgba(0,0,0,0.06);
}

.provider-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
}
.provider-name { font-weight: 500; font-size: 13px; color: #1a1a1a; }
.provider-percent { font-weight: 600; font-size: 14px; color: #4CAF50; }
.provider-percent.yellow { color: #FF9800; }
.provider-percent.red { color: #F44336; }

.progress-bar {
  height: 4px;
  background: #e0e0e0;
  border-radius: 2px;
  overflow: hidden;
  margin-bottom: 4px;
}
.progress-fill {
  height: 100%;
  background: #4CAF50;
  border-radius: 2px;
  transition: width 0.3s ease;
}
.progress-fill.yellow { background: #FF9800; }
.progress-fill.red { background: #F44336; }

.provider-bottom {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.usage-text {
  font-size: 11px;
  color: #666;
  font-family: 'SF Mono', 'Consolas', monospace;
}
.expire-text {
  font-size: 10px;
  color: #999;
}
</style>
