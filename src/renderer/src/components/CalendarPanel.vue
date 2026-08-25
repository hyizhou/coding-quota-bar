<!-- 自研月历网格：周一起始 7 列布局-->
<template>
  <div class="calendar-panel">
    <div class="cal-header">
      <button class="cal-nav" :title="$t('main.prevMonth')" @click="prevMonth">‹</button>
      <span class="cal-title">{{ title }}</span>
      <button class="cal-nav" :title="$t('main.nextMonth')" @click="nextMonth">›</button>
    </div>
    <div class="cal-grid cal-weekdays">
      <span v-for="w in weekdayLabels" :key="w" class="cal-weekday">{{ w }}</span>
    </div>
    <div class="cal-grid">
      <span
        v-for="(cell, i) in cells"
        :key="i"
        class="cal-cell"
        :class="{ empty: !cell, selected: cell?.selected, today: cell?.today }"
        @click="cell && emit('select', cell.iso)"
      >{{ cell?.day }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  /** 当前选中日期 YYYY-MM-DD */
  selected?: string
}>()

const emit = defineEmits<{ select: [iso: string] }>()

const { locale } = useI18n()
const localeTag = computed(() => (locale.value === 'zh-CN' ? 'zh-CN' : 'en-US'))

const today = new Date()
today.setHours(0, 0, 0, 0)

/** 本地日期字符串 YYYY-MM-DD */
function isoOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const todayIso = isoOf(today)

// 初始视图定位到选中日期或当前月
const initial = props.selected ? new Date(`${props.selected}T00:00:00`) : today
const viewYear = ref(initial.getFullYear())
const viewMonth = ref(initial.getMonth() + 1) // 1-12

const title = computed(() =>
  new Intl.DateTimeFormat(localeTag.value, { year: 'numeric', month: 'long' })
    .format(new Date(viewYear.value, viewMonth.value - 1, 1))
)

/** 周一至周日的窄标签（2024-01-01 恰为周一） */
const weekdayLabels = computed(() => {
  const fmt = new Intl.DateTimeFormat(localeTag.value, { weekday: 'narrow' })
  return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(2024, 0, 1 + i)))
})

interface DayCell { day: number; iso: string; selected: boolean; today: boolean }

const cells = computed<(DayCell | null)[]>(() => {
  const y = viewYear.value
  const m = viewMonth.value - 1
  const lead = (new Date(y, m, 1).getDay() + 6) % 7 // 周一起始的偏移
  const days = new Date(y, m + 1, 0).getDate()

  const list: (DayCell | null)[] = Array.from({ length: lead }, () => null)
  for (let d = 1; d <= days; d++) {
    const iso = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    list.push({
      day: d,
      iso,
      selected: iso === props.selected,
      today: iso === todayIso
    })
  }
  return list
})

function prevMonth() {
  viewMonth.value--
  if (viewMonth.value < 1) { viewMonth.value = 12; viewYear.value-- }
}

function nextMonth() {
  viewMonth.value++
  if (viewMonth.value > 12) { viewMonth.value = 1; viewYear.value++ }
}
</script>

<style scoped>
.calendar-panel {
  background: var(--bg-popover);
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  box-shadow: var(--shadow-card-hover);
  padding: 6px 8px;
  width: fit-content;
}

.cal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 4px;
}

.cal-title {
  font-size: 10px;
  font-weight: 600;
  color: var(--text-primary);
}

.cal-nav {
  background: none;
  border: none;
  border-radius: 6px;
  width: 16px;
  height: 16px;
  font-size: 12px;
  line-height: 1;
  color: var(--text-secondary);
  cursor: pointer;
  transition: background 0.15s;
}

.cal-nav:hover { background: var(--bg-hover); color: var(--text-primary); }

.cal-grid {
  display: grid;
  grid-template-columns: repeat(7, 20px);
  gap: 2px;
}

.cal-weekdays { margin-bottom: 1px; }

.cal-weekday {
  font-size: 8px;
  color: var(--text-tertiary);
  text-align: center;
  line-height: 20px;
}

.cal-cell {
  width: 20px;
  height: 20px;
  border-radius: 6px;
  font-size: 9px;
  color: var(--text-primary);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  font-variant-numeric: tabular-nums;
  transition: background 0.15s, color 0.15s;
  border: 1px solid transparent;
}

.cal-cell.empty { cursor: default; }

.cal-cell:hover:not(.empty):not(.selected) { background: var(--bg-hover); }

.cal-cell.today { border-color: #3b82f6; color: #3b82f6; }

.cal-cell.selected,
.cal-cell.selected.today {
  background: #3b82f6;
  border-color: #3b82f6;
  color: #fff;
}
</style>
