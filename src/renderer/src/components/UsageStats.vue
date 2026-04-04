<template>
  <div class="usage-stats">
    <div class="stats-header">
      <span class="stats-title">{{ title }}</span>
      <div class="stats-tabs">
        <button
          v-for="tab in tabs"
          :key="tab.value"
          class="tab-btn"
          :class="{ active: activeTab === tab.value }"
          @click="activeTab = tab.value"
        >{{ tab.label }}</button>
      </div>
    </div>
    <div class="chart-area">
      <div class="bar-chart">
        <div
          v-for="(bar, i) in chartBars"
          :key="i"
          class="bar-col"
        >
          <div class="bar-wrapper">
            <div
              class="bar-fill"
              :style="{ height: bar.height + '%' }"
            ></div>
          </div>
          <span class="bar-label">{{ bar.label }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import type { UsageRecord } from '../types'

const props = defineProps<{
  title: string
  records: UsageRecord[]
}>()

type TabValue = '1d' | '7d' | '30d'

const activeTab = ref<TabValue>('7d')

const tabs = [
  { label: '1天', value: '1d' as TabValue },
  { label: '7天', value: '7d' as TabValue },
  { label: '30天', value: '30d' as TabValue }
]

interface ChartBar {
  label: string
  value: number
  height: number
}

const chartBars = computed<ChartBar[]>(() => {
  if (!props.records.length) return []

  let filtered: UsageRecord[]
  if (activeTab.value === '1d') {
    filtered = props.records.slice(-1)
  } else if (activeTab.value === '7d') {
    filtered = props.records.slice(-7)
  } else {
    filtered = props.records.slice(-30)
  }

  const maxVal = Math.max(...filtered.map(r => r.used), 1)

  return filtered.map(r => ({
    label: activeTab.value === '30d'
      ? r.date.slice(8)  // DD
      : r.date.slice(5), // MM-DD
    value: r.used,
    height: Math.max((r.used / maxVal) * 100, 2)
  }))
})
</script>

<style scoped>
.usage-stats {
  margin-top: 8px;
}

.stats-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
}

.stats-title {
  font-size: 10px;
  font-weight: 600;
  color: #999;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.stats-tabs {
  display: flex;
  gap: 2px;
}

.tab-btn {
  background: none;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 4px;
  padding: 1px 6px;
  font-size: 10px;
  color: #999;
  cursor: pointer;
  transition: all 0.15s;
  line-height: 1.4;
}

.tab-btn:hover { color: #666; border-color: rgba(0, 0, 0, 0.15); }
.tab-btn.active {
  background: #22C55E;
  color: #fff;
  border-color: #22C55E;
}

.chart-area {
  height: 80px;
  background: rgba(255, 255, 255, 0.45);
  border-radius: 8px;
  padding: 6px 4px 2px;
}

.bar-chart {
  display: flex;
  align-items: flex-end;
  height: 100%;
  gap: 2px;
}

.bar-col {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  height: 100%;
  min-width: 0;
}

.bar-wrapper {
  flex: 1;
  width: 100%;
  display: flex;
  align-items: flex-end;
  justify-content: center;
}

.bar-fill {
  width: 70%;
  min-width: 4px;
  max-width: 16px;
  background: linear-gradient(180deg, #22C55E, rgba(34, 197, 94, 0.4));
  border-radius: 2px 2px 0 0;
  transition: height 0.4s cubic-bezier(0.4, 0, 0.2, 1);
}

.bar-label {
  font-size: 8px;
  color: #aaa;
  margin-top: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}
</style>
