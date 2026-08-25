<template>
  <template v-for="(row, ri) in getQuotaRows(account.quotas)" :key="ri">
    <div v-if="row.length === 1" class="quota-row-single">
      <QuotaCard v-bind="row[0]" />
    </div>
    <div v-else class="quota-row-pair">
      <QuotaCard v-for="q in row" :key="q.label" v-bind="q" />
    </div>
  </template>
  <UsageStats
    v-if="hasHistoryData(account)"
    :model-records-1d="account.modelHistory1d"
    :model-records-7d="account.modelHistory7d"
    :model-records-30d="account.modelHistory30d"
    :mcp-records-1d="account.mcpHistory1d"
    :mcp-records-7d="account.mcpHistory7d"
    :mcp-records-30d="account.mcpHistory30d"
    :model-rates="showCost ? account.modelRates : undefined"
  />
  <PerformanceChart
    v-if="hasPerformanceData(account)"
    :records-7d="account.performanceHistory7d"
    :records-15d="account.performanceHistory15d"
    :records-30d="account.performanceHistory30d"
  />
</template>

<script setup lang="ts">
import { ref, onMounted, defineAsyncComponent } from 'vue'
import QuotaCard from './QuotaCard.vue'
import UsageStats from './UsageStats.vue'
// PerformanceChart 含 chart.js → 异步加载，避免首屏阻塞
const PerformanceChart = defineAsyncComponent(() => import('./PerformanceChart.vue'))
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

const LIMIT_TYPE_ORDER: Record<string, number> = { mcp: 0, tokens: 1 }

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

  // 按 LIMIT_TYPE_ORDER 排序分组，确保 mcp 始终在 tokens 前面
  const sortedTypes = [...groupMap.keys()].sort(
    (a, b) => (LIMIT_TYPE_ORDER[a] ?? 99) - (LIMIT_TYPE_ORDER[b] ?? 99)
  )
  for (const type of sortedTypes) {
    const group = groupMap.get(type)!
    // tokens 组内：小时额度在前，周额度在后
    if (type === 'tokens') {
      group.sort((a, b) => {
        if (a.label === 'quota.tokensLimit' && b.label !== 'quota.tokensLimit') return -1
        if (a.label !== 'quota.tokensLimit' && b.label === 'quota.tokensLimit') return 1
        return 0
      })
    }
    rows.push(group)
  }

  return rows
}
</script>

<style scoped>
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
