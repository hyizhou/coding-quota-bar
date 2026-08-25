<template>
  <!-- 限流警告（页面顶部） -->
  <div v-if="account.limitReached" class="limit-warning">
    <span class="warning-icon">!</span>
    <span class="warning-text">{{ $t('quota.codexLimitReached') }}</span>
  </div>

  <!-- 主窗口 / 次窗口 QuotaCard 各占一行 -->
  <div v-for="q in windowQuotas" :key="q.label" class="quota-row-single">
    <QuotaCard v-bind="q" />
  </div>

  <!-- 代码审查额度（可选） -->
  <div v-for="q in reviewQuotas" :key="q.label" class="quota-row-single">
    <QuotaCard v-bind="q" />
  </div>

  <!-- 余额卡片 -->
  <div v-if="creditItem" class="credits-card">
    <span class="credits-label">{{ $t(creditItem.label) }}</span>
    <span class="credits-value">${{ creditItem.used.toFixed(2) }}</span>
  </div>

  <!-- 订阅到期（可选） -->
  <div v-if="subscriptionItem" class="info-card">
    <span class="info-label">{{ $t('quota.codexSubscriptionUntil') }}</span>
    <span class="info-value">{{ formatDate(subscriptionItem.resetAt) }}</span>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import QuotaCard from './QuotaCard.vue'
import type { AccountUsageData } from '../types'

const { locale } = useI18n()

const props = defineProps<{
  account: AccountUsageData
}>()

const windowQuotas = computed(() =>
  props.account.quotas.filter(q => q.limitType === 'codex')
)

const reviewQuotas = computed(() =>
  props.account.quotas.filter(q => q.limitType === 'codex-review')
)

const creditItem = computed(() =>
  props.account.quotas.find(q => q.limitType === 'codex-credits')
)

const subscriptionItem = computed(() =>
  props.account.quotas.find(q => q.limitType === 'codex-subscription')
)

function formatDate(iso: string): string {
  if (!iso) return ''
  try {
    const d = new Date(iso)
    if (isNaN(d.getTime())) return iso
    return d.toLocaleDateString(locale.value, { year: 'numeric', month: 'short', day: 'numeric' })
  } catch {
    return iso
  }
}
</script>

<style scoped>
.limit-warning {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  background: var(--bg-error);
  border: 1px solid var(--border-error);
  border-radius: 8px;
  margin-bottom: 6px;
}

.warning-icon {
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--cqb-red);
  color: #fff;
  font-size: 12px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
}

.warning-text {
  font-size: 12px;
  color: var(--text-error);
  line-height: 1.4;
}

.quota-row-single {
  margin-bottom: 6px;
}

.credits-card {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  padding: 8px 10px;
  background: var(--bg-card);
  border-radius: 8px;
  box-shadow: var(--shadow-card);
  margin-bottom: 6px;
  transition: background 0.2s, box-shadow 0.2s;
}

.credits-card:hover {
  background: var(--bg-card-hover);
  box-shadow: var(--shadow-card-hover);
}

.credits-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-heading);
}

.credits-value {
  font-size: 18px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--text-primary);
}

.info-card {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  padding: 8px 10px;
  background: var(--bg-card);
  border-radius: 8px;
  box-shadow: var(--shadow-card);
  margin-bottom: 6px;
  transition: background 0.2s, box-shadow 0.2s;
}

.info-card:hover {
  background: var(--bg-card-hover);
  box-shadow: var(--shadow-card-hover);
}

.info-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-heading);
}

.info-value {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-secondary);
}
</style>
