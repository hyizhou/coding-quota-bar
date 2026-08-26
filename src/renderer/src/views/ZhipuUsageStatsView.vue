<!--
  智谱用量统计页：展示 credit-usage/activity 接口返回的
  总使用量、单日峰值、使用时长、连续天数等汇总信息 + 每日用量日历热力图。
  入口：主页智谱额度卡片（5小时额度 / MCP 用量 / 周额度）点击进入
-->
<template>
  <div class="view-zhipu-stats">
    <header class="header">
      <button class="icon-btn back-btn" :title="$t('settings.backBtn')" @click="$emit('go-back')">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="15 18 9 12 15 6"/>
        </svg>
      </button>
      <h1>{{ $t('zhipuStats.title') }}</h1>
      <span v-if="accountLabel" class="account-label">{{ accountLabel }}</span>
    </header>

    <div class="stats-body">
      <!-- 加载骨架 -->
      <div v-if="loading" class="skeleton-group">
        <div class="skeleton-grid">
          <div v-for="i in 4" :key="i" class="skeleton summary-skeleton"></div>
        </div>
        <div class="skeleton calendar-skeleton"></div>
      </div>

      <!-- 加载失败 -->
      <div v-else-if="error" class="error-block">
        <p class="error-title">{{ $t('zhipuStats.loadFailed') }}</p>
        <p class="error-detail">{{ error }}</p>
        <button class="retry-btn" @click="load">{{ $t('zhipuStats.retry') }}</button>
      </div>

      <!-- 无数据 -->
      <div v-else-if="empty" class="empty-block">{{ $t('zhipuStats.noData') }}</div>

      <template v-else>
        <!-- 汇总卡片 -->
        <div class="summary-grid">
          <div class="summary-card">
            <span class="summary-label">{{ $t('zhipuStats.totalUsage') }}</span>
            <span class="summary-value">{{ formatCount(summary?.totalTokens ?? 0) }}</span>
            <span class="summary-sub">tokens</span>
          </div>
          <div class="summary-card">
            <span class="summary-label">{{ $t('zhipuStats.peakDaily') }}</span>
            <span class="summary-value">{{ formatCount(summary?.peakDailyTokens ?? 0) }}</span>
            <span class="summary-sub">{{ peakDateText }}</span>
          </div>
          <div class="summary-card">
            <span class="summary-label">{{ $t('zhipuStats.usageDuration') }}</span>
            <span class="summary-value">{{ durationHours }}<small class="unit">{{ $t('zhipuStats.hoursUnit') }}</small></span>
          </div>
          <div class="summary-card">
            <span class="summary-label">{{ $t('zhipuStats.streak') }}</span>
            <span class="summary-value">{{ summary?.currentStreakDays ?? 0 }}<small class="unit">{{ $t('zhipuStats.daysUnit') }}</small></span>
            <span class="summary-sub">{{ $t('zhipuStats.longestStreak', { n: summary?.longestStreakDays ?? 0 }) }}</span>
          </div>
        </div>

        <!-- 本月用量 -->
        <div class="month-row">
          <div class="month-cell">
            <span class="month-label">{{ $t('zhipuStats.monthTokens') }}</span>
            <span class="month-value">{{ formatCount(monthTokens) }}</span>
          </div>
          <div class="month-cell">
            <span class="month-label">{{ $t('zhipuStats.monthMcp') }}</span>
            <span class="month-value">{{ monthMcpCalls }}</span>
          </div>
        </div>

        <!-- 日历热力图 -->
        <div class="calendar-card">
          <div class="calendar-head">
            <span class="calendar-title">{{ $t('zhipuStats.calendarTitle') }}</span>
            <div class="mode-toggle">
              <button
                v-for="m in modes"
                :key="m.value"
                class="tab-btn"
                :class="{ active: mode === m.value }"
                @click="mode = m.value"
              >{{ m.label }}</button>
            </div>
          </div>
          <ZhipuUsageCalendar :records="series" :mode="mode" />
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import ZhipuUsageCalendar from '../components/ZhipuUsageCalendar.vue'
import type { ZhipuDailyUsageItem, ZhipuUsageActivitySummary } from '../types'

const props = defineProps<{
  accountId: string
  accountLabel?: string
}>()

defineEmits<{ 'go-back': [] }>()

const { t, locale } = useI18n()

const loading = ref(false)
const error = ref('')
const summary = ref<ZhipuUsageActivitySummary | null>(null)
const series = ref<ZhipuDailyUsageItem[]>([])

const empty = computed(() => !summary.value && series.value.length === 0)

// Token / MCP 视图切换，持久化用户选择
const STORAGE_KEY_MODE = 'zhipu-stats-mode'
type StatsMode = 'token' | 'mcp'
const mode = ref<StatsMode>(restoreMode())

function restoreMode(): StatsMode {
  try {
    const saved = localStorage.getItem(STORAGE_KEY_MODE)
    if (saved === 'token' || saved === 'mcp') return saved
  } catch {}
  return 'token'
}

watch(mode, v => { try { localStorage.setItem(STORAGE_KEY_MODE, v) } catch {} })

const modes = [
  { label: t('zhipuStats.tokenView'), value: 'token' as StatsMode },
  { label: t('zhipuStats.mcpView'), value: 'mcp' as StatsMode }
]

async function load() {
  if (!props.accountId) return
  loading.value = true
  error.value = ''
  try {
    const result = await window.electronAPI.zhipuFetchUsageStats(props.accountId)
    if (result?.error) {
      error.value = result.error.replace(/^\[[\w-]+\]\s*/, '')
    } else {
      summary.value = result?.summary ?? null
      series.value = result?.series ?? []
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

onMounted(load)

const durationHours = computed(() => {
  const ms = summary.value?.totalUsageDurationMs ?? 0
  return (ms / 3_600_000).toFixed(1)
})

const peakDateText = computed(() => {
  const raw = summary.value?.peakDailyTokensDate
  if (!raw) return ''
  const d = new Date(raw)
  return isNaN(d.getTime()) ? raw : d.toLocaleDateString(locale.value, { month: 'short', day: 'numeric' })
})

const monthTokens = computed(() => sumMonth('totalTokens'))
const monthMcpCalls = computed(() => sumMonth('mcpCalls'))

function sumMonth(field: 'totalTokens' | 'mcpCalls'): number {
  const now = new Date()
  const prefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  return series.value.reduce((sum, r) => r.date.startsWith(prefix) ? sum + r[field] : sum, 0)
}

function formatCount(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(2)}K`
  return `${n}`
}
</script>

<style scoped>
.view-zhipu-stats {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.account-label {
  margin-left: 6px;
  font-size: 10px;
  color: var(--text-tertiary);
  background: var(--bg-hover);
  padding: 2px 6px;
  border-radius: 6px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 120px;
}

.stats-body {
  flex: 1;
  overflow-y: auto;
  padding: 2px 0 6px;
}
.stats-body::-webkit-scrollbar { width: 3px; }
.stats-body::-webkit-scrollbar-thumb { background: var(--scrollbar-thumb); border-radius: 2px; }

/* 汇总卡片 2x2 */
.summary-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
  margin-bottom: 6px;
}

.summary-card {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 10px;
  background: var(--bg-card);
  border-radius: 8px;
  box-shadow: var(--shadow-card);
}

.summary-label {
  font-size: 10px;
  font-weight: 600;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.summary-value {
  font-size: 18px;
  font-weight: 700;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
  line-height: 1.2;
}

.summary-value .unit {
  font-size: 10px;
  font-weight: 600;
  margin-left: 3px;
  color: var(--text-tertiary);
}

.summary-sub {
  font-size: 10px;
  color: var(--text-tertiary);
  font-variant-numeric: tabular-nums;
}

/* 本月用量行 */
.month-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
  margin-bottom: 6px;
}

.month-cell {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  padding: 6px 10px;
  background: var(--bg-card);
  border-radius: 8px;
  box-shadow: var(--shadow-card);
}

.month-label {
  font-size: 11px;
  color: var(--text-secondary);
}

.month-value {
  font-size: 13px;
  font-weight: 700;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
}

/* 日历卡片 */
.calendar-card {
  padding: 10px;
  background: var(--bg-card);
  border-radius: 8px;
  box-shadow: var(--shadow-card);
}

.calendar-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.calendar-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-heading);
}

.mode-toggle {
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

/* 加载骨架 */
.skeleton {
  border-radius: 8px;
  background: linear-gradient(90deg, var(--skeleton-a) 25%, var(--skeleton-b) 50%, var(--skeleton-a) 75%);
  background-size: 200% 100%;
  animation: shimmer 1.5s ease-in-out infinite;
}

.skeleton-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
  margin-bottom: 6px;
}

.summary-skeleton { height: 62px; }
.calendar-skeleton { height: 300px; }

@keyframes shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

/* 错误 / 空状态 */
.error-block,
.empty-block {
  text-align: center;
  padding: 28px 12px;
  color: var(--text-secondary);
}

.error-title {
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 6px;
  color: var(--text-heading);
}

.error-detail {
  font-size: 11px;
  color: var(--text-tertiary);
  margin-bottom: 12px;
  word-break: break-all;
}

.retry-btn {
  font-size: 11px;
  padding: 4px 14px;
  border: 1px solid var(--border-default);
  border-radius: 6px;
  background: transparent;
  color: var(--text-primary);
  cursor: pointer;
  transition: all 0.15s;
}
.retry-btn:hover {
  background: var(--bg-hover);
}
</style>
