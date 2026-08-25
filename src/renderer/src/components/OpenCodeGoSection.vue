<template>
  <div v-for="quota in sortedQuotas" :key="quota.limitType!" class="quota-row">
    <ModelQuotaCard :title="quota.limitType!" :quotas="[quota]" />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import ModelQuotaCard from './ModelQuotaCard.vue'
import type { AccountUsageData, QuotaItem } from '../types'

const props = defineProps<{
  account: AccountUsageData
}>()

const sortedQuotas = computed<QuotaItem[]>(() => {
  // 顺序：5h → weekly → monthly（与 OpenCode 后端返回顺序一致）
  const order = ['5h', 'weekly', 'monthly']
  return [...(props.account.quotas ?? [])].sort((a, b) => {
    const ai = order.indexOf(a.limitType ?? '')
    const bi = order.indexOf(b.limitType ?? '')
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi)
  })
})
</script>

<style scoped>
.quota-row {
  margin-bottom: 6px;
}
</style>
