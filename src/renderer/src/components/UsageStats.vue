<template>
  <div class="usage-stats">
    <div class="stats-tabs-row">
      <div class="stats-type-tabs">
        <button
          v-for="ct in chartTypes"
          :key="ct.value"
          class="tab-btn"
          :class="{ active: activeChart === ct.value }"
          @click="activeChart = ct.value"
        >{{ ct.label }}</button>
      </div>
      <div class="stats-time-tabs">
        <button
          v-for="tab in tabs"
          :key="tab.value"
          class="tab-btn"
          :class="{ active: activeTab === tab.value }"
          @click="activeTab = tab.value"
        >{{ tab.label }}</button>
      </div>
    </div>
    <TokenChart
      v-if="activeChart === 'token'"
      :title="$t('main.tokenStats')"
      :records-1d="records1d"
      :records-7d="records7d"
      :records-30d="records30d"
      :active-tab="activeTab"
    />
    <McpChart
      v-else
      :title="$t('main.mcpStats')"
      :records-1d="mcpRecords1d"
      :records-7d="mcpRecords7d"
      :records-30d="mcpRecords30d"
      :active-tab="activeTab"
    />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import TokenChart from './TokenChart.vue'
import McpChart from './McpChart.vue'
import type { UsageRecord, McpUsageRecord } from '../types'

const { t } = useI18n()

const props = defineProps<{
  records1d: UsageRecord[]
  records7d: UsageRecord[]
  records30d: UsageRecord[]
  mcpRecords1d: McpUsageRecord[]
  mcpRecords7d: McpUsageRecord[]
  mcpRecords30d: McpUsageRecord[]
}>()

type ChartType = 'token' | 'mcp'
type TabValue = '1d' | '7d' | '30d'

const activeChart = ref<ChartType>('token')
const activeTab = ref<TabValue>('7d')

const chartTypes = [
  { label: 'Token', value: 'token' as ChartType },
  { label: 'MCP', value: 'mcp' as ChartType }
]

const tabs = [
  { label: '1天', value: '1d' as TabValue },
  { label: '7天', value: '7d' as TabValue },
  { label: '30天', value: '30d' as TabValue }
]
</script>

<style scoped>
.usage-stats {
  margin-top: 8px;
}

.stats-tabs-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
}

.stats-type-tabs,
.stats-time-tabs {
  display: flex;
  gap: 2px;
}

.tab-btn {
  background: none;
  border: 1px solid var(--border-tab);
  border-radius: 4px;
  padding: 1px 6px;
  font-size: 10px;
  color: var(--text-tertiary);
  cursor: pointer;
  transition: all 0.15s;
  line-height: 1.4;
}

.tab-btn:hover { color: var(--text-secondary); border-color: var(--border-tab-hover); }
.tab-btn.active {
  background: var(--bg-toggle-active);
  color: var(--bg-input);
  border-color: var(--bg-toggle-active);
}
</style>
