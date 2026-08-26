<!--
  通用 GitHub 风格用量热力图组件：按周分列、横向滚动、月份标签、强度图例
  数据格式 { date: 'YYYY-MM-DD', value: number }，周一为每周第一天
  复用方通过 formatValue 自定义悬浮提示文案，通过 select 事件获取点击日期
-->
<template>
  <div class="usage-heatmap">
    <div class="hm-body">
      <div class="wd-col">
        <span v-for="(w, i) in weekdayLabels" :key="i" class="wd">{{ w }}</span>
      </div>
      <div ref="scrollEl" class="hm-scroll">
        <div class="hm-inner" :style="{ width: innerWidth + 'px' }">
          <div class="months-row">
            <span
              v-for="m in monthLabels"
              :key="m.key"
              class="month-label"
              :style="{ left: m.left + 'px' }"
            >{{ m.text }}</span>
          </div>
          <div class="weeks-row">
            <div v-for="(week, wi) in weeks" :key="wi" class="week-col">
              <span
                v-for="(cell, ci) in week"
                :key="ci"
                class="cell"
                :class="[cell.date ? `l${cell.level}` : 'empty', { today: cell.today, selected: cell.date === selected }]"
                :title="cell.date ? tip(cell) : undefined"
                @click="cell.date && emit('select', cell.date)"
              ></span>
            </div>
          </div>
        </div>
      </div>
    </div>
    <div class="hm-legend">
      <span>{{ $t('heatmap.less') }}</span>
      <span class="lg l0"></span>
      <span class="lg l1"></span>
      <span class="lg l2"></span>
      <span class="lg l3"></span>
      <span class="lg l4"></span>
      <span>{{ $t('heatmap.more') }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

/**
 * 热力图单条记录
 */
export interface HeatmapRecord {
  date: string   // 'YYYY-MM-DD'
  value: number
}

const props = withDefaults(defineProps<{
  records: HeatmapRecord[]
  /** 悬浮提示中数值的格式化函数 */
  formatValue?: (n: number) => string
  /** 当前选中日期（高亮边框由使用方控制） */
  selected?: string
}>(), {
  selected: undefined,
})

const emit = defineEmits<{ select: [date: string] }>()

const { locale } = useI18n()

const CELL = 12
const GAP = 2
const COL_W = CELL + GAP

const today = new Date()
const todayStr = localDate(today)

const scrollEl = ref<HTMLElement | null>(null)

// 默认滚动到最右侧（最近一周）
onMounted(() => {
  if (scrollEl.value) scrollEl.value.scrollLeft = scrollEl.value.scrollWidth
})

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function localDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** 解析 YYYY-MM-DD 为本地时区日期（避免 new Date(str) 的 UTC 偏移问题） */
function parseDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

/** 周一为一周开始 */
function startOfWeek(d: Date): Date {
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  r.setDate(r.getDate() - (r.getDay() + 6) % 7)
  return r
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d)
  r.setDate(r.getDate() + n)
  return r
}

const dayMap = computed(() => {
  const map = new Map<string, number>()
  for (const r of props.records) map.set(r.date, r.value)
  return map
})

const maxValue = computed(() => {
  let max = 0
  for (const r of props.records) {
    if (r.value > max) max = r.value
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

interface Cell {
  date?: string
  value: number
  level: number
  today: boolean
}

const weeks = computed<Cell[][]>(() => {
  if (!props.records.length) return []
  const cursor = startOfWeek(parseDate(props.records[0].date))
  const end = startOfWeek(today)
  const cols: Cell[][] = []

  while (cursor.getTime() <= end.getTime()) {
    const col: Cell[] = []
    for (let i = 0; i < 7; i++) {
      const d = addDays(cursor, i)
      const ds = localDate(d)
      // 今日之后（本周尾部）与数据范围之外的日期不渲染格子
      if (d > today || !dayMap.value.has(ds)) {
        col.push({ value: 0, level: 0, today: false })
        continue
      }
      const value = dayMap.value.get(ds)!
      col.push({ date: ds, value, level: levelOf(value), today: ds === todayStr })
    }
    cols.push(col)
    cursor.setDate(cursor.getDate() + 7)
  }
  return cols
})

/** 每列周一起始，月份变化处显示月份标签 */
const monthLabels = computed(() => {
  const labels: Array<{ key: string; left: number; text: string }> = []
  let prevMonth = -1
  for (let i = 0; i < weeks.value.length; i++) {
    const firstCell = weeks.value[i].find(c => c.date)
    if (!firstCell?.date) continue
    const d = parseDate(firstCell.date)
    if (d.getMonth() !== prevMonth) {
      prevMonth = d.getMonth()
      labels.push({
        key: firstCell.date,
        left: i * COL_W,
        text: d.toLocaleDateString(locale.value, { month: 'short' }),
      })
    }
  }
  return labels
})

const innerWidth = computed(() => weeks.value.length * COL_W)

/** 周一/周三/周五显示窄标签（同 GitHub 的稀疏排布） */
const weekdayLabels = computed(() => {
  const fmt = (d: Date) => d.toLocaleDateString(locale.value, { weekday: 'narrow' })
  return [fmt(new Date(2024, 0, 1)), '', fmt(new Date(2024, 0, 3)), '', fmt(new Date(2024, 0, 5)), '', '']
})

function tip(cell: Cell): string {
  const value = props.formatValue ? props.formatValue(cell.value) : cell.value.toLocaleString()
  return `${cell.date} · ${value}`
}
</script>

<style scoped>
.usage-heatmap {
  user-select: none;
}

.hm-body {
  display: grid;
  grid-template-columns: 12px 1fr;
  gap: 0 3px;
}

/* 左侧星期标签列，与格子行高对齐 */
.wd-col {
  display: grid;
  grid-template-rows: repeat(7, 12px);
  gap: 2px;
  padding-top: 16px;
}

.wd {
  font-size: 8px;
  color: var(--text-tertiary);
  line-height: 12px;
  text-align: center;
}

.hm-scroll {
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: thin;
}
.hm-scroll::-webkit-scrollbar { height: 3px; }
.hm-scroll::-webkit-scrollbar-thumb { background: var(--scrollbar-thumb); border-radius: 2px; }

.months-row {
  position: relative;
  height: 12px;
  margin-bottom: 4px;
}

.month-label {
  position: absolute;
  top: 0;
  font-size: 9px;
  color: var(--text-tertiary);
  line-height: 12px;
  white-space: nowrap;
}

.weeks-row {
  display: flex;
  gap: 2px;
}

.week-col {
  display: grid;
  grid-template-rows: repeat(7, 12px);
  gap: 2px;
}

.cell {
  width: 12px;
  height: 12px;
  border-radius: 2.5px;
  background: var(--border-subtle);
  cursor: pointer;
  transition: box-shadow 0.1s;
}
.cell:hover:not(.empty) {
  box-shadow: 0 0 0 1px var(--text-secondary);
}
.cell.empty {
  background: transparent;
  cursor: default;
}
.cell.today {
  box-shadow: inset 0 0 0 1px var(--text-secondary);
}
.cell.today:hover:not(.empty) {
  box-shadow: 0 0 0 1px var(--text-secondary);
}
.cell.selected {
  box-shadow: inset 0 0 0 1.5px #16a34a;
}

/* 绿色强度阶梯（light / dark 双主题），图例复用 */
.l0 { background: var(--border-subtle); }
.l1 { background: #dcfce7; }
.l2 { background: #86efac; }
.l3 { background: #4ade80; }
.l4 { background: #16a34a; }
:global(html.dark) .l1 { background: #14532d; }
:global(html.dark) .l2 { background: #166534; }
:global(html.dark) .l3 { background: #15803d; }
:global(html.dark) .l4 { background: #22c55e; }

.hm-legend {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 3px;
  margin-top: 6px;
  font-size: 9px;
  color: var(--text-tertiary);
}

.lg {
  width: 9px;
  height: 9px;
  border-radius: 2px;
}
</style>
