<template>
  <div v-for="group in getModelGroups(account.quotas)" :key="group[0].limitType!" class="quota-row-single">
    <ModelQuotaCard :title="group[0].limitType!" :quotas="group" />
  </div>
</template>

<script setup lang="ts">
import ModelQuotaCard from './ModelQuotaCard.vue'
import type { AccountUsageData, QuotaItem } from '../types'

defineProps<{
  account: AccountUsageData
}>()

function getModelGroups(quotas: QuotaItem[]): QuotaItem[][] {
  const groupMap = new Map<string, QuotaItem[]>()
  const groups: QuotaItem[][] = []
  const seen = new Set<string>()

  for (const q of quotas) {
    const key = q.limitType || ''
    if (!groupMap.has(key)) groupMap.set(key, [])
    groupMap.get(key)!.push(q)
  }

  for (const q of quotas) {
    const key = q.limitType || ''
    if (!seen.has(key)) {
      seen.add(key)
      groups.push(groupMap.get(key)!)
    }
  }

  return groups
}
</script>

<style scoped>
.quota-row-single {
  margin-bottom: 6px;
}
</style>
