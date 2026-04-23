<template>
  <template v-for="(row, ri) in getQuotaRows(account.quotas)" :key="ri">
    <div v-if="row.length === 1" class="quota-row-single">
      <QuotaCard v-bind="row[0]" />
    </div>
    <div v-else class="quota-row-pair">
      <QuotaCard v-for="q in row" :key="q.label" v-bind="q" />
    </div>
  </template>
  <div v-if="showCost && account.estimatedCost30d > 0" class="cost-hint">
    {{ $t('main.estimatedCost', { amount: account.estimatedCost30d.toFixed(2) }) }}
  </div>
  <UsageStats
    v-if="hasHistoryData(account)"
    :model-records-1d="account.modelHistory1d"
    :model-records-7d="account.modelHistory7d"
    :model-records-30d="account.modelHistory30d"
    :mcp-records-1d="account.mcpHistory1d"
    :mcp-records-7d="account.mcpHistory7d"
    :mcp-records-30d="account.mcpHistory30d"
  />
  <PerformanceChart
    v-if="hasPerformanceData(account)"
    :records-7d="account.performanceHistory7d"
    :records-15d="account.performanceHistory15d"
    :records-30d="account.performanceHistory30d"
  />
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import QuotaCard from './QuotaCard.vue'
import UsageStats from './UsageStats.vue'
import PerformanceChart from './PerformanceChart.vue'
import type { AccountUsageData, QuotaItem } from '../types'

defineProps<{
  account: AccountUsageData
}>()

const showCost = ref(false)
onMounted(async () => {
  const config = await window.electronAPI.getConfig()
  showCost.value = config?.showEstimatedCost ?? false
})

function hasHistoryData(acc: AccountUsageData): boolean {
  return acc.modelHistory1d.length > 0 || acc.modelHistory7d.length > 0 || acc.modelHistory30d.length > 0 ||
    acc.mcpHistory1d.length > 0 || acc.mcpHistory7d.length > 0 || acc.mcpHistory30d.length > 0
}

function hasPerformanceData(acc: AccountUsageData): boolean {
  return acc.performanceHistory7d.length > 0 || acc.performanceHistory15d.length > 0 || acc.performanceHistory30d.length > 0
}

function getQuotaRows(quotas: QuotaItem[]): QuotaItem[][] {
  const groupMap = new Map<string, QuotaItem[]>()
  const rows: QuotaItem[][] = []
  const seen = new Set<string>()

  for (const q of quotas) {
    if (!q.limitType) {
      rows.push([q])
    } else {
      if (!groupMap.has(q.limitType)) groupMap.set(q.limitType, [])
      groupMap.get(q.limitType)!.push(q)
    }
  }

  for (const q of quotas) {
    if (q.limitType && !seen.has(q.limitType)) {
      seen.add(q.limitType)
      rows.push(groupMap.get(q.limitType)!)
    }
  }

  return rows
}
</script>

<style scoped>
.cost-hint {
  font-size: 10px;
  color: var(--text-tertiary);
  text-align: right;
  margin-bottom: 6px;
  padding-right: 2px;
}

.quota-row-single {
  margin-bottom: 6px;
}

.quota-row-pair {
  display: flex;
  gap: 6px;
  margin-bottom: 6px;
}

.quota-row-pair :deep(.quota-card) {
  flex: 1;
  min-width: 0;
  padding: 6px 8px;
}

.quota-row-pair :deep(.quota-label) {
  font-size: 11px;
}

.quota-row-pair :deep(.quota-percent) {
  font-size: 14px;
}

.quota-row-pair :deep(.reset-text) {
  font-size: 9px;
}
</style>
