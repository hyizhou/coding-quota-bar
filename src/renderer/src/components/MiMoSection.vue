<template>
  <!-- 订阅信息卡片 -->
  <div class="subscription-card card" v-if="account.subscription">
    <div class="sub-header">
      <span class="sub-plan">{{ account.subscription.plan }}</span>
      <span class="sub-status" v-if="account.subscription.status === 'EXPIRED'" style="color: #ef4444">{{ t('provider.expired') }}</span>
    </div>
    <div class="sub-detail">
      <span v-if="account.subscription.nextRenewTime">
        {{ t('subscription.nextRenew') }} {{ formatDate(account.subscription.nextRenewTime) }}
      </span>
      <span :class="account.subscription.autoRenew ? 'auto-renew-on' : 'auto-renew-off'">
        {{ t('subscription.autoRenew') }}: {{ account.subscription.autoRenew ? t('subscription.yes') : t('subscription.no') }}
      </span>
    </div>
  </div>

  <!-- 本月用量（主指标） -->
  <div class="credits-card" v-if="monthlyQuota">
    <div class="credits-top">
      <span class="credits-label">{{ $t(monthlyQuota.label) }}</span>
      <span class="credits-percent" :class="monthlyQuota.color">{{ Math.round(monthlyQuota.usageRate) }}%</span>
    </div>
    <div class="credits-bar">
      <div class="credits-fill" :class="monthlyQuota.color" :style="{ width: monthlyQuota.usageRate + '%' }"></div>
    </div>
    <div class="credits-bottom">
      <span class="credits-values">{{ formatCredits(monthlyQuota.used) }} / {{ formatCredits(monthlyQuota.total) }} Credits</span>
      <span class="credits-reset">{{ formatReset(monthlyQuota.resetAt) }}</span>
    </div>
  </div>

  <!-- 补偿额度（如果有） -->
  <div class="quota-row-single" v-for="q in compensationQuotas" :key="q.label">
    <QuotaCard
      :label="q.label"
      :labelParams="q.labelParams"
      :usageRate="q.usageRate"
      :resetAt="q.resetAt"
      :color="q.color"
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import QuotaCard from './QuotaCard.vue'
import type { AccountUsageData, QuotaItem } from '../types'

const props = defineProps<{ account: AccountUsageData }>()
const { t, locale } = useI18n()

const monthlyQuota = computed(() =>
  props.account.quotas.find(q => q.label === 'quota.mimoMonthlyUsage')
)

const compensationQuotas = computed(() =>
  props.account.quotas.filter(q => q.label === 'quota.mimoCompensation')
)

function formatCredits(n: number): string {
  return n.toLocaleString()
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleDateString(undefined, { year: 'numeric', month: '2-digit', day: '2-digit' })
  } catch {
    return iso
  }
}

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
.subscription-card {
  margin-bottom: 6px;
}

.sub-header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 2px;
}

.sub-plan {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-heading);
}

.sub-status {
  font-size: 11px;
  font-weight: 600;
}

.sub-detail {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 11px;
  color: var(--text-tertiary);
}

.auto-renew-on {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 4px;
  background: rgba(34, 197, 94, 0.1);
  color: #22c55e;
  border: 1px solid rgba(34, 197, 94, 0.2);
}

.auto-renew-off {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 4px;
  background: rgba(156, 163, 175, 0.1);
  color: var(--text-tertiary);
  border: 1px solid rgba(156, 163, 175, 0.2);
}

.credits-card {
  padding: 8px 10px;
  background: var(--bg-card);
  border-radius: 8px;
  box-shadow: var(--shadow-card);
  transition: background 0.2s, box-shadow 0.2s;
}

.credits-card:hover {
  background: var(--bg-card-hover);
  box-shadow: var(--shadow-card-hover);
}

.credits-top {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 5px;
}

.credits-label {
  font-weight: 600;
  font-size: 13px;
  color: var(--text-heading);
}

.credits-percent {
  font-weight: 700;
  font-size: 16px;
  font-variant-numeric: tabular-nums;
  color: var(--text-primary);
}
.credits-percent.yellow { color: #a16207; }
.credits-percent.red { color: #dc2626; }

.credits-bar {
  height: 6px;
  background: var(--border-subtle);
  border-radius: 3px;
  overflow: hidden;
  margin-bottom: 5px;
}

.credits-fill {
  height: 100%;
  border-radius: 3px;
  transition: width 0.5s cubic-bezier(0.4, 0, 0.2, 1);
}
.credits-fill.green { background: linear-gradient(90deg, #4ade80, #22c55e); }
.credits-fill.yellow { background: linear-gradient(90deg, #facc15, #eab308); }
.credits-fill.red { background: linear-gradient(90deg, #f87171, #ef4444); }

.credits-bottom {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.credits-values {
  font-size: 11px;
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
}

.credits-reset {
  font-size: 10px;
  color: var(--text-tertiary);
}
</style>
