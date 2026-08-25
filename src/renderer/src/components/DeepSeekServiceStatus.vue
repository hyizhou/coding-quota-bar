<template>
  <template v-if="account.serviceStatus?.length">
    <div v-for="svc in account.serviceStatus" :key="svc.id" class="status-card">
      <div class="svc-header">
        <span class="svc-name link" @click="openStatusPage">{{ svcName(svc) }}</span>
        <span class="svc-uptime">{{ svc.uptime }}%</span>
      </div>
      <div class="svc-bar-row">
        <span class="svc-badge" :class="svcBadgeClass(svc.status)">
          <span class="svc-dot"></span>
          {{ svcStatusText(svc.status) }}
        </span>
      </div>
      <div class="svc-days">
        <span
          v-for="(day, i) in svc.days"
          :key="i"
          class="day-block"
          :class="day"
          :title="dayTitle(i)"
        ></span>
      </div>
    </div>
  </template>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { AccountUsageData, DeepSeekServiceComponent, ComponentStatus } from '../types'

const { t, locale } = useI18n()

defineProps<{
  account: AccountUsageData
}>()

function svcName(svc: DeepSeekServiceComponent): string {
  // Flashcat 组件 ID（2026-06 迁移后）
  if (svc.id === '01KR3NC9ETZYF436Z8YT1HM047') return t('quota.deepseekApiService')
  if (svc.id === '01KR3NC9ETESRRQ4GABE0TGW53') return t('quota.deepseekWebService')
  return svc.name
}

function svcBadgeClass(status: ComponentStatus): string {
  if (status === 'operational') return 'ok'
  if (status === 'degraded_performance') return 'warn'
  return 'error'
}

function svcStatusText(status: ComponentStatus): string {
  if (status === 'operational') return t('quota.statusOperational')
  if (status === 'degraded_performance') return t('quota.statusDegraded')
  if (status === 'partial_outage') return t('quota.statusPartialOutage')
  return t('quota.statusMajorOutage')
}

function openStatusPage(): void {
  window.electronAPI.openExternal('https://status.deepseek.com/')
}

function dayTitle(offsetFromEnd: number): string {
  const today = new Date()
  const d = new Date(today)
  d.setDate(d.getDate() - (89 - offsetFromEnd))
  return d.toLocaleDateString(locale.value, { month: 'short', day: 'numeric' })
}
</script>

<style scoped>
.status-card {
  padding: 8px 10px;
  background: var(--bg-card);
  border-radius: 8px;
  box-shadow: var(--shadow-card);
  transition: background 0.2s, box-shadow 0.2s;
  margin-top: 6px;
}

.status-card:hover {
  background: var(--bg-card-hover);
  box-shadow: var(--shadow-card-hover);
}

.svc-header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
}

.svc-name {
  font-weight: 600;
  font-size: 13px;
  color: var(--text-heading);
}

.svc-name.link {
  cursor: pointer;
  transition: color 0.15s;
}

.svc-name.link:hover {
  color: var(--text-primary);
}

.svc-uptime {
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  color: var(--text-tertiary);
}

.svc-bar-row {
  margin-top: 4px;
}

.svc-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  font-weight: 500;
}

.svc-badge.ok { color: #16a34a; }
.svc-badge.warn { color: #ca8a04; }
  .svc-badge.error { color: var(--cqb-red-dark); }

.svc-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
}

  .svc-badge.ok .svc-dot { background: var(--cqb-green); }
  .svc-badge.warn .svc-dot { background: var(--cqb-yellow-dark); }
  .svc-badge.error .svc-dot { background: var(--cqb-red); }

.svc-days {
  display: flex;
  gap: 1px;
  margin-top: 6px;
}

.day-block {
  flex: 1;
  height: 8px;
  border-radius: 1px;
  min-width: 1px;
}

  .day-block.operational { background: var(--cqb-green); }
  .day-block.degraded { background: var(--cqb-yellow-dark); }
  .day-block.outage { background: var(--cqb-red); }
.day-block.maintenance { background: #3b82f6; }
</style>
