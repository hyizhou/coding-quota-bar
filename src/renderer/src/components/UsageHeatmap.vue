<!--
  通用 GitHub 风格用量热力图组件（Canvas 绘制版）：
  按周分列、横向滚动、月份标签、强度图例、悬浮提示与点击选中均绘制在同一 canvas 上，
  避免为每天生成 DOM 节点（365 天 ≈ 365 个节点 → 1 个 canvas，仅在数据/主题/交互变化时重绘）
  数据格式 { date: 'YYYY-MM-DD', value: number }，周日为每周第一天
  复用方通过 formatValue 自定义悬浮提示文案，通过 select 事件获取点击日期
-->
<template>
  <div class="usage-heatmap">
    <div class="hm-body">
      <div class="wd-col">
        <span v-for="(w, i) in weekdayLabels" :key="i" class="wd">{{ w }}</span>
      </div>
      <div ref="scrollEl" class="hm-scroll" @wheel.prevent="onWheel">
        <canvas
          ref="canvasEl"
          class="hm-canvas"
          :style="{ width: cssWidth + 'px', height: cssHeight + 'px' }"
          @mousemove="onMove"
          @mouseleave="onLeave"
          @click="onClick"
        ></canvas>
      </div>
    </div>
    <div class="hm-legend">
      <span>{{ $t('heatmap.less') }}</span>
      <span v-for="(c, i) in legendColors" :key="i" class="lg" :style="{ background: c }"></span>
      <span>{{ $t('heatmap.more') }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watchEffect } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTheme } from '../composables/useTheme'

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
const { isDark } = useTheme()

// 布局常量（CSS 像素）
const CELL = 12
const GAP = 2
const COL_W = CELL + GAP
const ROW_H = CELL + GAP
const MONTH_ROW_H = 16   // 月份标签行高（12px 文字 + 4px 间距）
const FONT = `system-ui, -apple-system, 'Segoe UI', 'Microsoft YaHei', sans-serif`

// 强度阶梯色（level 0 无用量，取主题边框色，绘制时动态读取）
const LIGHT_LEVELS = ['#dcfce7', '#86efac', '#4ade80', '#16a34a']
const DARK_LEVELS = ['#14532d', '#166534', '#15803d', '#22c55e']

const today = new Date()
const todayStr = localDate(today)

const scrollEl = ref<HTMLElement | null>(null)
const canvasEl = ref<HTMLCanvasElement | null>(null)

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

/** 周日为一周开始 */
function startOfWeek(d: Date): Date {
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  r.setDate(r.getDate() - r.getDay())
  return r
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d)
  r.setDate(r.getDate() + n)
  return r
}

/** 读取主题 CSS 变量 */
function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
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
      // 今日之后（本周尾部）与数据范围之外的日期不绘制格子
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

const cssWidth = computed(() => weeks.value.length * COL_W)
const cssHeight = MONTH_ROW_H + 7 * CELL + 6 * GAP

/** 周日/周三/周五显示窄标签（同 GitHub 的稀疏排布） */
const weekdayLabels = computed(() => {
  const fmt = (d: Date) => d.toLocaleDateString(locale.value, { weekday: 'narrow' })
  // 行序为 周日~周六：2024-01-07 周日、2024-01-10 周三、2024-01-12 周五
  return [fmt(new Date(2024, 0, 7)), '', '', fmt(new Date(2024, 0, 10)), '', fmt(new Date(2024, 0, 12)), '']
})

/** 图例颜色（level 0 + 强度阶梯），与画布绘制同源 */
const legendColors = computed(() => {
  void isDark.value  // 主题切换时重新计算
  return [cssVar('--border-subtle'), ...(isDark.value ? DARK_LEVELS : LIGHT_LEVELS)]
})

// ---------- 交互 ----------

interface HoverCell {
  col: number
  row: number
  date: string
  value: number
}

const hoverCell = ref<HoverCell | null>(null)

function cellAt(x: number, y: number): { col: number; row: number; cell: Cell } | null {
  const col = Math.floor(x / COL_W)
  const row = Math.floor((y - MONTH_ROW_H) / ROW_H)
  if (col < 0 || row < 0 || row > 6) return null
  const cell = weeks.value[col]?.[row]
  if (!cell?.date) return null
  return { col, row, cell }
}

function onMove(e: MouseEvent): void {
  const canvas = canvasEl.value
  if (!canvas) return
  const rect = canvas.getBoundingClientRect()
  const hit = cellAt(e.clientX - rect.left, e.clientY - rect.top)
  if (hit) {
    // 仅命中变化时更新，避免 mousemove 高频触发重绘
    if (hoverCell.value?.col !== hit.col || hoverCell.value?.row !== hit.row) {
      hoverCell.value = { col: hit.col, row: hit.row, date: hit.cell.date!, value: hit.cell.value }
    }
    canvas.style.cursor = 'pointer'
  } else {
    if (hoverCell.value) hoverCell.value = null
    canvas.style.cursor = 'default'
  }
}

function onLeave(): void {
  hoverCell.value = null
  if (canvasEl.value) canvasEl.value.style.cursor = 'default'
}

function onClick(): void {
  if (hoverCell.value) emit('select', hoverCell.value.date)
}

// ---------- 平滑滚动 ----------

let animFrame = 0
let animTarget = 0
const ANIM_DURATION = 150

/** 滚轮在热力图区域转为横向平滑滚动（触控板横向手势优先），不滚动页面 */
function onWheel(e: WheelEvent): void {
  const el = scrollEl.value
  if (!el) return
  const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY

  // 动画进行中在目标位置上累加，连续滚动时目标顺延、动画即时重定锚
  const max = el.scrollWidth - el.clientWidth
  const base = animFrame ? animTarget : el.scrollLeft
  animTarget = Math.max(0, Math.min(base + delta, max))

  if (animFrame) cancelAnimationFrame(animFrame)
  const from = el.scrollLeft
  const start = performance.now()

  const step = (now: number): void => {
    const t = Math.min(1, (now - start) / ANIM_DURATION)
    const eased = 1 - Math.pow(1 - t, 3)  // easeOutCubic
    el.scrollLeft = from + (animTarget - from) * eased
    animFrame = t < 1 ? requestAnimationFrame(step) : 0
  }
  animFrame = requestAnimationFrame(step)
}

onUnmounted(() => {
  if (animFrame) cancelAnimationFrame(animFrame)
  animFrame = 0
})

// ---------- 绘制 ----------

watchEffect(() => {
  const canvas = canvasEl.value
  if (!canvas) return
  const cols = weeks.value
  const labels = monthLabels.value
  const hover = hoverCell.value
  const selected = props.selected
  const dark = isDark.value

  const w = cssWidth.value
  const h = cssHeight
  if (w <= 0) return

  const dpr = window.devicePixelRatio || 1
  const pxW = Math.round(w * dpr)
  const pxH = Math.round(h * dpr)
  if (canvas.width !== pxW || canvas.height !== pxH) {
    canvas.width = pxW
    canvas.height = pxH
  }
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, w, h)

  const levels = [cssVar('--border-subtle'), ...(dark ? DARK_LEVELS : LIGHT_LEVELS)]
  const tertiary = cssVar('--text-tertiary')
  const secondary = cssVar('--text-secondary')
  const primary = cssVar('--text-primary')
  const bgApp = cssVar('--bg-app')

  // 月份标签
  ctx.font = `9px ${FONT}`
  ctx.fillStyle = tertiary
  ctx.textBaseline = 'top'
  for (const m of labels) {
    ctx.fillText(m.text, m.left, 0)
  }

  // 用量格子
  for (let i = 0; i < cols.length; i++) {
    for (let j = 0; j < 7; j++) {
      const cell = cols[i][j]
      if (!cell.date) continue
      const x = i * COL_W
      const y = MONTH_ROW_H + j * ROW_H
      ctx.beginPath()
      ctx.roundRect(x + 0.5, y + 0.5, CELL - 1, CELL - 1, 2.5)
      ctx.fillStyle = levels[cell.level]
      ctx.fill()

      if (cell.date === selected) {
        ctx.strokeStyle = '#16a34a'
        ctx.lineWidth = 1.5
        ctx.strokeRect(x + 0.75, y + 0.75, CELL - 1.5, CELL - 1.5)
      } else if (cell.today) {
        ctx.strokeStyle = secondary
        ctx.lineWidth = 1
        ctx.strokeRect(x + 0.5, y + 0.5, CELL - 1, CELL - 1)
      }
      if (hover && hover.col === i && hover.row === j) {
        ctx.strokeStyle = secondary
        ctx.lineWidth = 1
        ctx.strokeRect(x + 0.5, y + 0.5, CELL - 1, CELL - 1)
      }
    }
  }

  // 悬浮提示（画在画布内，自动随内容横向滚动，顶部行自动翻到格子下方）
  if (hover) {
    const valueText = props.formatValue ? props.formatValue(hover.value) : hover.value.toLocaleString()
    const label = `${hover.date} · ${valueText}`
    ctx.font = `10px ${FONT}`
    const tw = ctx.measureText(label).width
    const bw = tw + 12
    const bh = 18
    let bx = hover.col * COL_W + CELL / 2 - bw / 2
    bx = Math.max(2, Math.min(bx, w - bw - 2))
    let by = MONTH_ROW_H + hover.row * ROW_H - bh - 4
    if (by < 0) by = MONTH_ROW_H + hover.row * ROW_H + CELL + 4

    ctx.beginPath()
    ctx.roundRect(bx, by, bw, bh, 4)
    ctx.globalAlpha = 0.96
    ctx.fillStyle = bgApp
    ctx.fill()
    ctx.globalAlpha = 1
    ctx.strokeStyle = cssVar('--border-default')
    ctx.lineWidth = 1
    ctx.stroke()
    ctx.fillStyle = primary
    ctx.textBaseline = 'middle'
    ctx.fillText(label, bx + 6, by + bh / 2 + 0.5)
  }
})
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

/* 左侧星期标签列，与画布格子行高对齐 */
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
}
/* 现代细滚动条：4px 细条、透明轨道，悬浮滚动条本体时颜色加深 */
.hm-scroll::-webkit-scrollbar { height: 4px; }
.hm-scroll::-webkit-scrollbar-track { background: transparent; }
.hm-scroll::-webkit-scrollbar-thumb { background: var(--scrollbar-thumb); border-radius: 2px; }
.hm-scroll::-webkit-scrollbar-thumb:hover { background: var(--text-tertiary); }

.hm-canvas {
  display: block;
}

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
