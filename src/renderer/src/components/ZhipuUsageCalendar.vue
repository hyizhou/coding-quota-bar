<!--
  智谱每日用量日历热力图：按月展示 Token / MCP 调用强度，
  数据来自 credit-usage/activity 接口（近一年），点击日期查看当日明细
-->
<template>
  <div class="usage-calendar">
    <div class="cal-nav">
      <button class="nav-btn" :disabled="!canPrev" @click="prevMonth">‹</button>
      <span class="month-label">{{ monthLabel }}</span>
      <button class="nav-btn" :disabled="!canNext" @click="nextMonth">›</button>
      <span class="month-sum">{{ monthSumText }}</span>
    </div>

    <div class="weekday-row">
      <span v-for="(w, i) in weekdays" :key="i" class="weekday">{{ w }}</span>
    </div>

    <div class="day-grid">
      <template v-for="cell in cells" :key="cell.key">
        <span v-if="!cell.day" class="day-cell blank"></span>
        <span
          v-else
          class="day-cell"
          :class="[`level-${cell.level}`, { future: cell.future, today: cell.today, selected: cell.date === selectedDate, none: !cell.has }]"
          :title="cell.has ? tipText(cell) : cell.date"
          @click="cell.has && (selectedDate = cell.date!)"
        ></span>
      </template>
    </div>

    <div v-if="selected" class="day-detail">
      <span class="detail-date">{{ selectedLabel }}</span>
      <span class="detail-items">
        <span>{{ $t('zhipuStats.detailTokens') }}: <strong>{{ formatCount(selected.totalTokens) }}</strong></span>
        <span>{{ $t('zhipuStats.detailMcp') }}: <strong>{{ selected.mcpCalls }}</strong></span>
        <span v-if="selected.totalCredits > 0">{{ $t('zhipuStats.detailCredits') }}: <strong>{{ selected.totalCredits }}</strong></span>
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ZhipuDailyUsageItem } from '../types'

const props = defineProps<{
  records: ZhipuDailyUsageItem[]
  mode: 'token' | 'mcp'
}>()

const { t, tm, locale } = useI18n()

const weekdays = computed(() => tm('zhipuStats.weekdays') as string[])

// 当前展示月份（默认本月）
const now = new Date()
const viewYear = ref(now.getFullYear())
const viewMonth = ref(now.getMonth() + 1)
const selectedDate = ref<string | null>(null)

const dayMap = computed(() => {
  const map = new Map<string, ZhipuDailyUsageItem>()
  for (const r of props.records) map.set(r.date, r)
  return map
})

// 全量数据的单日最大值（决定颜色强度的分母）
const maxValue = computed(() => {
  let max = 0
  for (const r of props.records) {
    const v = props.mode === 'token' ? r.totalTokens : r.mcpCalls
    if (v > max) max = v
  }
  return max
})

function levelOf(value: number): number {
  if (value <= 0 || maxValue.value <= 0) return 0
  const ratio = value / maxValue.value
  if (ratio < 0.25) return 1
  if (ratio < 0.5) return 2
  if (ratio < 0.75) return 3
  return 4
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function localDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

const todayStr = localDate(now)

const cells = computed(() => {
  const first = new Date(viewYear.value, viewMonth.value - 1, 1)
  const startWeekday = (first.getDay() + 6) % 7  // 周一为第一列
  const daysInMonth = new Date(viewYear.value, viewMonth.value, 0).getDate()
  const list: Array<{
    key: string
    day?: number
    date?: string
    value: number
    level: number
    future: boolean
    today: boolean
    has: boolean
  }> = []

  for (let i = 0; i < startWeekday; i++) {
    list.push({ key: `blank-${i}`, value: 0, level: 0, future: false, today: false, has: false })
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const date = `${viewYear.value}-${pad(viewMonth.value)}-${pad(d)}`
    const item = dayMap.value.get(date)
    const value = item ? (props.mode === 'token' ? item.totalTokens : item.mcpCalls) : 0
    list.push({
      key: date,
      day: d,
      date,
      value,
      level: item ? levelOf(value) : 0,
      future: date > todayStr,
      today: date === todayStr,
      has: !!item,
    })
  }
  return list
})

// 数据首月 ~ 本月 之间可翻页
const firstRecordDate = computed(() => props.records[0]?.date ?? '')
const canPrev = computed(() => {
  if (!firstRecordDate.value) return false
  const [y, m] = firstRecordDate.value.split('-').map(Number)
  return viewYear.value * 12 + viewMonth.value > y * 12 + m
})
const canNext = computed(() => {
  return viewYear.value * 12 + viewMonth.value < now.getFullYear() * 12 + now.getMonth() + 1
})

function prevMonth() {
  if (!canPrev.value) return
  viewMonth.value--
  if (viewMonth.value === 0) { viewMonth.value = 12; viewYear.value-- }
}

function nextMonth() {
  if (!canNext.value) return
  viewMonth.value++
  if (viewMonth.value === 13) { viewMonth.value = 1; viewYear.value++ }
}

const monthLabel = computed(() =>
  new Date(viewYear.value, viewMonth.value - 1, 1).toLocaleDateString(locale.value, { year: 'numeric', month: 'long' })
)

const monthSumText = computed(() => {
  const prefix = `${viewYear.value}-${pad(viewMonth.value)}`
  let tokens = 0
  let mcp = 0
  for (const r of props.records) {
    if (!r.date.startsWith(prefix)) continue
    tokens += r.totalTokens
    mcp += r.mcpCalls
  }
  const value = props.mode === 'token' ? formatCount(tokens) : String(mcp)
  return `${t('zhipuStats.monthTotal')} ${value}`
})

const selected = computed(() => selectedDate.value ? dayMap.value.get(selectedDate.value) ?? null : null)

const selectedLabel = computed(() => {
  if (!selectedDate.value) return ''
  const d = new Date(selectedDate.value)
  return isNaN(d.getTime()) ? selectedDate.value : d.toLocaleDateString(locale.value, { month: 'short', day: 'numeric' })
})

function formatCount(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(2)}K`
  return `${n}`
}

function tipText(cell: { date?: string; value: number }): string {
  const unit = props.mode === 'token' ? 'tokens' : t('zhipuStats.callsUnit')
  return `${cell.date} · ${props.mode === 'token' ? formatCount(cell.value) : cell.value} ${unit}`
}
</script>

<style scoped>
.usage-calendar {
  user-select: none;
}

.cal-nav {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 6px;
}

.nav-btn {
  width: 20px;
  height: 20px;
  border: 1px solid var(--border-subtle);
  border-radius: 6px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1;
  cursor: pointer;
  transition: all 0.15s;
}
.nav-btn:hover:not(:disabled) {
  border-color: var(--border-default);
  color: var(--text-heading);
}
.nav-btn:disabled {
  opacity: 0.3;
  cursor: default;
}

.month-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-heading);
  min-width: 72px;
  text-align: center;
}

.month-sum {
  margin-left: auto;
  font-size: 10px;
  color: var(--text-tertiary);
  font-variant-numeric: tabular-nums;
}

.weekday-row {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 3px;
  margin-bottom: 3px;
}

.weekday {
  font-size: 9px;
  color: var(--text-tertiary);
  text-align: center;
  line-height: 1.2;
}

.day-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 3px;
}

.day-cell {
  aspect-ratio: 1;
  border-radius: 4px;
  background: var(--border-subtle);
  cursor: pointer;
  transition: transform 0.1s;
}
.day-cell:hover:not(.blank):not(.none) {
  transform: scale(1.08);
}
.day-cell.blank {
  background: transparent;
  cursor: default;
}
.day-cell.none {
  background: transparent;
  border: 1px dashed var(--border-subtle);
  cursor: default;
}
.day-cell.future {
  background: transparent;
  border: 1px dashed var(--border-subtle);
  cursor: default;
}
.day-cell.today {
  box-shadow: inset 0 0 0 1.5px var(--text-secondary);
}
.day-cell.selected {
  box-shadow: inset 0 0 0 2px #16a34a;
}

/* 绿色强度阶梯（light / dark 双主题） */
.level-1 { background: #dcfce7; }
.level-2 { background: #86efac; }
.level-3 { background: #4ade80; }
.level-4 { background: #16a34a; }
:global(html.dark) .level-1 { background: #14532d; }
:global(html.dark) .level-2 { background: #166534; }
:global(html.dark) .level-3 { background: #15803d; }
:global(html.dark) .level-4 { background: #22c55e; }

.day-detail {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--border-subtle);
  flex-wrap: wrap;
}

.detail-date {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-heading);
}

.detail-items {
  display: flex;
  gap: 8px;
  font-size: 10px;
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
}
.detail-items strong {
  color: var(--text-primary);
  font-weight: 600;
}
</style>
