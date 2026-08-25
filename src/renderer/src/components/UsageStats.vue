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
      :model-records-1d="modelRecords1d"
      :model-records-7d="modelRecords7d"
      :model-records-30d="modelRecords30d"
      :active-tab="activeTab"
      :model-rates="modelRates"
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
import { ref, watch, defineAsyncComponent } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ModelTokenRecord, McpUsageRecord } from '../types'

// chart.js + vue-chartjs 加起来 ~610KB，按需加载
// 首屏不下载，用户点开图表 tab 时才加载
const TokenChart = defineAsyncComponent(() => import('./TokenChart.vue'))
const McpChart = defineAsyncComponent(() => import('./McpChart.vue'))

const { t } = useI18n()

const props = defineProps<{
  modelRecords1d: ModelTokenRecord[]
  modelRecords7d: ModelTokenRecord[]
  modelRecords30d: ModelTokenRecord[]
  mcpRecords1d: McpUsageRecord[]
  mcpRecords7d: McpUsageRecord[]
  mcpRecords30d: McpUsageRecord[]
  modelRates?: Record<string, number>
}>()

type ChartType = 'token' | 'mcp'
type TabValue = 'today' | '24h' | '7d' | '30d'

const STORAGE_KEY_CHART = 'usage-stats-chart'
const STORAGE_KEY_TAB = 'usage-stats-tab'

function restore<V>(key: string, valid: V[], fallback: V): V {
  try {
    const saved = localStorage.getItem(key) as V
    if (valid.includes(saved)) return saved
  } catch {}
  return fallback
}

const activeChart = ref<ChartType>(restore(STORAGE_KEY_CHART, ['token', 'mcp'], 'token'))
const activeTab = ref<TabValue>(restore(STORAGE_KEY_TAB, ['today', '24h', '7d', '30d'], '7d'))

watch(activeChart, v => { try { localStorage.setItem(STORAGE_KEY_CHART, v) } catch {} })
watch(activeTab, v => { try { localStorage.setItem(STORAGE_KEY_TAB, v) } catch {} })

const chartTypes = [
  { label: t('main.tabToken'), value: 'token' as ChartType },
  { label: t('main.tabMcp'), value: 'mcp' as ChartType }
]

const tabs = [
  { label: t('main.tabToday'), value: 'today' as TabValue },
  { label: t('main.tab24h'), value: '24h' as TabValue },
  { label: t('main.tab7d'), value: '7d' as TabValue },
  { label: t('main.tab30d'), value: '30d' as TabValue }
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
