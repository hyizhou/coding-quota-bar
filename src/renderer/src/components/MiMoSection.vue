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
      <span v-if="account.subscription.autoRenew" class="auto-renew-badge">{{ t('subscription.autoRenew') }}</span>
    </div>
  </div>

  <!-- QuotaCard 列表 -->
  <div class="quota-row-single" v-for="q in account.quotas" :key="q.label">
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
import { useI18n } from 'vue-i18n'
import QuotaCard from './QuotaCard.vue'
import type { AccountUsageData } from '../types'

defineProps<{ account: AccountUsageData }>()

const { t } = useI18n()

function formatDate(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleDateString(undefined, { year: 'numeric', month: '2-digit', day: '2-digit' })
  } catch {
    return iso
  }
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
  gap: 8px;
  font-size: 11px;
  color: var(--text-tertiary);
}

.auto-renew-badge {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 4px;
  background: rgba(34, 197, 94, 0.1);
  color: #22c55e;
  border: 1px solid rgba(34, 197, 94, 0.2);
}
</style>
