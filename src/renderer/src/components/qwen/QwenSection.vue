<!--
  千问 / 百炼 Token Plan 专属卡片区块：各窗口额度卡（ModelQuotaCard，按 5h → weekly → monthly 排序），
  已知套餐总额时标题附带 Credits 绝对用量；底部展示套餐规格与到期时间。
-->
<template>
  <div v-for="quota in sortedQuotas" :key="quota.limitType!" class="quota-row">
    <ModelQuotaCard :title="quotaTitle(quota)" :quotas="[quota]" />
  </div>
  <div v-if="sortedQuotas.length === 0" class="qwen-empty">{{ $t('quota.qwenNoUsage') }}</div>
  <div v-if="subscriptionText" class="qwen-subscription">{{ subscriptionText }}</div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import ModelQuotaCard from '../ModelQuotaCard.vue'
import type { AccountUsageData, QuotaItem } from '../../types'

const props = defineProps<{
  account: AccountUsageData
}>()

const { t } = useI18n()

const sortedQuotas = computed<QuotaItem[]>(() => {
  // 顺序：5h → weekly → monthly，其余窗口排后
  const order = ['5h', 'weekly', 'monthly']
  return [...(props.account.quotas ?? [])].sort((a, b) => {
    const ai = order.indexOf(a.limitType ?? '')
    const bi = order.indexOf(b.limitType ?? '')
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi)
  })
})

function formatCredits(n: number): string {
  return Math.round(n).toLocaleString()
}

function quotaTitle(quota: QuotaItem): string {
  const params = quota.labelParams ?? {}
  const title = t(quota.label, params)
  const total = Number(params.totalCredits ?? 0)
  if (total <= 0) return title
  const used = Number(params.usedCredits ?? 0)
  return `${title} · ${t('quota.qwenCreditsAmount', { used: formatCredits(used), total: formatCredits(total) })}`
}

function formatDate(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}`
}

const subscriptionText = computed(() => {
  const sub = props.account.qwenSubscription
  if (!sub) return ''
  const parts: string[] = []
  const end = formatDate(sub.endAt)
  if (end) parts.push(t('quota.qwenExpiresAt', { date: end }))
  if (sub.remainingDays != null) parts.push(t('quota.qwenRemainingDays', { n: sub.remainingDays }))
  parts.push(sub.autoRenew ? t('quota.qwenAutoRenewOn') : t('quota.qwenAutoRenewOff'))
  return parts.join(' · ')
})
</script>

<style scoped>
.quota-row {
  margin-bottom: 6px;
}

.qwen-empty {
  padding: 10px;
  font-size: 12px;
  color: var(--text-secondary);
  text-align: center;
  background: var(--bg-card);
  border-radius: 10px;
  box-shadow: var(--shadow-card);
  margin-bottom: 6px;
}

.qwen-subscription {
  font-size: 10px;
  color: var(--text-secondary);
  text-align: right;
  padding: 0 2px;
  font-variant-numeric: tabular-nums;
}
</style>
