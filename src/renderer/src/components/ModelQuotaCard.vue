<template>
  <div class="model-quota-card">
    <div class="model-header">{{ title }}</div>
    <div v-for="(q, i) in quotas" :key="i" class="quota-row">
      <div class="quota-top">
        <span class="quota-range">{{ formatRange(q.startAt, q.resetAt) }}</span>
        <span class="quota-percent" :class="q.color">{{ formatRemaining(q) }}</span>
      </div>
      <div v-if="q.total > 0 && !q.hideBar" class="progress-bar">
        <div class="progress-fill" :class="q.color" :style="{ width: formatProgressWidth(q) }"></div>
      </div>
      <div class="quota-bottom">
        <span class="quota-count" :class="{ 'quota-unlimited': q.total === 0 }">{{ formatQuotaDetail(q) }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { QuotaItem } from '../types'

defineProps<{
  title: string
  quotas: QuotaItem[]
}>()

const { t } = useI18n()

function clampPercent(n: number): number {
  return Math.max(0, Math.min(100, Number.isFinite(n) ? n : 0))
}

function isCountQuota(q: QuotaItem): boolean {
  return q.displayUnit === 'count'
}

function formatProgressWidth(q: QuotaItem): string {
  return `${clampPercent(q.usageRate)}%`
}

function formatRemaining(q: QuotaItem): string {
  if (q.total === 0) return '∞'
  if (isCountQuota(q)) {
    return String(Math.max(0, Math.round(q.total - q.used)))
  }
  return `${Math.round(100 - clampPercent(q.usageRate))}%`
}

function formatQuotaDetail(q: QuotaItem): string {
  if (q.total === 0) return `∞ ${t('quota.unlimited')}`
  if (isCountQuota(q)) {
    return `${Math.max(0, Math.round(q.used))} / ${Math.max(0, Math.round(q.total))}`
  }

  const boostPermille = Number(q.labelParams?.boostPermille || 0)
  const usedText = t('quota.usedPercent', { n: Math.round(clampPercent(q.usageRate)) })
  if (boostPermille > 1000) {
    return `${t('quota.totalPercent', { n: Math.round(boostPermille / 10) })} · ${usedText}`
  }
  return usedText
}

function formatTime(iso: string): string {
  if (!iso) return ''
  try {
    const d = new Date(iso)
    if (isNaN(d.getTime())) return ''
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  } catch { return '' }
}

function formatRange(startIso: string | undefined, endIso: string): string {
  const end = formatTime(endIso)
  if (!startIso) return end
  const start = formatTime(startIso)
  if (!start) return end
  return `${start} - ${end}`
}
</script>

<style scoped>
.model-quota-card {
  padding: 8px 10px;
  background: var(--bg-card);
  border-radius: 10px;
  box-shadow: var(--shadow-card);
  transition: background 0.2s, box-shadow 0.2s;
}

.model-quota-card:hover {
  background: var(--bg-card-hover);
  box-shadow: var(--shadow-card-hover);
}

.model-header {
  font-weight: 700;
  font-size: 13px;
  color: var(--text-heading);
  margin-bottom: 6px;
}

.quota-row {
  margin-bottom: 6px;
}

.quota-row:last-child {
  margin-bottom: 0;
}

.quota-top {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 3px;
}

.quota-range {
  min-width: 0;
  font-size: 10px;
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.quota-percent {
  flex-shrink: 0;
  min-width: 40px;
  text-align: right;
  font-weight: 700;
  font-size: 14px;
  font-variant-numeric: tabular-nums;
  color: var(--text-primary);
}
.quota-percent.yellow { color: #a16207; }
  .quota-percent.red { color: var(--cqb-red-dark); }

.progress-bar {
  height: 5px;
  background: var(--border-subtle);
  border-radius: 3px;
  overflow: hidden;
  margin-bottom: 2px;
}

.progress-fill {
  height: 100%;
  border-radius: 3px;
  transition: width 0.5s cubic-bezier(0.4, 0, 0.2, 1);
}
  .progress-fill.green { background: linear-gradient(90deg, var(--cqb-green-light), var(--cqb-green)); }
  .progress-fill.yellow { background: linear-gradient(90deg, var(--cqb-yellow-light), var(--cqb-yellow)); }
  .progress-fill.red { background: linear-gradient(90deg, var(--cqb-red-light), var(--cqb-red)); }

.quota-bottom {
  display: flex;
  justify-content: flex-end;
  align-items: baseline;
}

.quota-count {
  font-size: 10px;
  font-variant-numeric: tabular-nums;
  color: var(--text-secondary);
  text-align: right;
}

.reset-text {
  font-size: 9px;
  color: var(--text-tertiary);
}
</style>
