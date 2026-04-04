<template>
  <div class="view-main">
    <header class="header">
      <h1>{{ $t('main.title') }}</h1>
      <div class="header-actions">
        <button class="icon-btn" :title="$t('main.settingsBtn')" @click="$emit('open-settings')">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
          </svg>
        </button>
        <button class="icon-btn" :title="$t('main.refreshBtn')" :disabled="loading" :class="{ spinning: loading }" @click="handleRefresh">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
          </svg>
        </button>
      </div>
    </header>

    <div class="providers-list">
      <template v-if="providers.length === 0">
        <div class="empty-state">
          <p>{{ $t('main.emptyState') }}</p>
          <p class="hint">{{ $t('main.emptyHint') }}</p>
        </div>
      </template>
      <ProviderCard
        v-for="p in sortedProviders"
        :key="p.name"
        v-bind="p"
      />
    </div>

    <div class="chart-section" v-if="providers.length > 0">
      <div class="section-label">{{ $t('main.chartSection') }}</div>
      <UsageChart :chart-data="chartData" />
    </div>

    <footer class="footer">
      <span>{{ lastUpdateText }}</span>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import ProviderCard from '../components/ProviderCard.vue'
import UsageChart from '../components/UsageChart.vue'
import type { ProviderUsageData, UsageState } from '../types'

defineEmits<{ 'open-settings': [] }>()

const { t, locale } = useI18n()

const providers = ref<ProviderUsageData[]>([])
const lastUpdate = ref('')
const loading = ref(false)
const now = ref(Date.now())

const sortedProviders = computed(() =>
  [...providers.value].sort((a, b) => a.percent - b.percent)
)

const lastUpdateText = computed(() => {
  if (!lastUpdate.value) return t('main.lastUpdateFallback')
  try {
    const date = new Date(lastUpdate.value)
    const diffMins = Math.floor((now.value - date.getTime()) / 60000)
    if (diffMins < 1) return t('main.justNow')
    if (diffMins < 60) return t('main.minutesAgo', { n: diffMins })
    if (diffMins < 1440) return t('main.hoursAgo', { n: Math.floor(diffMins / 60) })
    return date.toLocaleTimeString(locale.value, { hour: '2-digit', minute: '2-digit' })
  } catch { return lastUpdate.value }
})

// Mock chart data
const chartData = computed(() => {
  const labels: string[] = []
  const data: number[] = []
  const current = new Date()
  let prev = 2500
  for (let i = 11; i >= 0; i--) {
    const h = new Date(current.getTime() - i * 3600000)
    labels.push(`${h.getHours().toString().padStart(2, '0')}:00`)
    prev = Math.max(200, prev + (Math.random() - 0.4) * 1500)
    data.push(Math.round(prev))
  }
  return {
    labels,
    datasets: [{
      label: t('main.tokenUsage'),
      data,
      backgroundColor: 'rgba(76, 175, 80, 0.5)',
      borderColor: 'rgba(76, 175, 80, 0.8)',
      borderWidth: 1,
      borderRadius: 2
    }]
  }
})

function applyState(state: UsageState) {
  providers.value = state.providers
  lastUpdate.value = state.lastUpdate
}

async function fetchData() {
  try {
    const state = await window.electronAPI.getUsageData()
    if (state) applyState(state)
  } catch (e) { console.error('[MainView] fetch failed:', e) }
}

async function handleRefresh() {
  loading.value = true
  try {
    const state = await window.electronAPI.refreshUsage()
    if (state) applyState(state)
  } catch (e) { console.error('[MainView] refresh failed:', e) }
  finally { loading.value = false }
}

setInterval(() => { now.value = Date.now() }, 60000)

onMounted(fetchData)
</script>

<style scoped>
.view-main {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.providers-list {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.providers-list::-webkit-scrollbar { width: 3px; }
.providers-list::-webkit-scrollbar-thumb { background: #ccc; border-radius: 2px; }

.chart-section {
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px solid #eee;
}

.section-label {
  font-size: 10px;
  font-weight: 600;
  color: #999;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 4px;
}

.empty-state {
  text-align: center;
  padding: 24px 12px;
  color: #aaa;
}
.empty-state p { margin-bottom: 4px; }
.empty-state .hint { font-size: 11px; color: #ccc; }

.spinning svg {
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
</style>
