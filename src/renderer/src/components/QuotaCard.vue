<!--改此组件慎重，基础组件，被多个服务商依赖-->
<template>
  <div class="quota-card">
    <div class="card-top">
      <span class="quota-label">{{ $t(label, labelParams ?? {}) }}</span>
      <span class="quota-percent" :class="color">{{ animatedPercent.formatted.value }}%</span>
    </div>
    <div class="progress-bar">
      <div class="progress-fill" :style="progressStyle"></div>
    </div>
    <div class="card-bottom">
      <span v-if="projection" class="projection" :class="`projection-${projection.urgency}`">
        {{ projection.text }}
      </span>
      <span class="reset-text">{{ formatReset(resetAt) }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAnimatedNumber } from '../composables/useAnimatedNumber'

const props = defineProps<{
  label: string
  labelParams?: Record<string, string | number>
  usageRate: number
  resetAt: string
  color: 'green' | 'yellow' | 'red'
  hideBar?: boolean
  /**
   * 预估消耗速率（%/小时）。由父组件根据历史使用数据计算后传入。
   * - undefined / 0 / null：不显示预估时间
   * - > 0：按 (100 - usageRate) / burnRatePerHour 估算剩余小时数
   */
  burnRatePerHour?: number
}>()

const { t, locale } = useI18n()

// 百分比平滑过渡：数据刷新时数字不会跳变
const animatedPercent = useAnimatedNumber(() => props.usageRate, { duration: 500, decimals: 0 })

/**
 * HSL 渐变进度条：
 * - 0%   → 绿 (hsl 142, 70%, 50%)
 * - 50%  → 黄 (hsl 48, 95%, 55%)
 * - 100% → 红 (hsl 0, 90%, 60%)
 * 用 hsl 色相线性插值得到连续色阶，比离散三色过渡更细腻
 */
const progressStyle = computed(() => {
  const rate = Math.max(0, Math.min(100, animatedPercent.value.value))
  const hue = 142 - (rate / 100) * 142
  const sat = 70
  const light = 60 - (rate / 100) * 5
  return {
    width: `${rate}%`,
    background: `linear-gradient(90deg, hsl(${hue}, ${sat}%, ${light + 8}%), hsl(${hue}, ${sat}%, ${light}%))`,
  }
})

/**
 * 预估爆仓时间
 * 算式：remainingHours = (100 - usageRate) / burnRatePerHour
 * 显示策略：
 *  - 已耗尽（100%）→ 红色 "⚠ 已耗尽" + 闪烁
 *  - < 2h 后用完 → 红色 + 闪烁
 *  - < 8h → 黄色
 *  - 8-24h → 绿色
 *  - > 24h → 不显示（提示价值低，且大概率 reset 已临近）
 *  - 速率未提供/0 → 不显示
 */
const projection = computed(() => {
  const rate = animatedPercent.value.value
  if (rate >= 100) return { text: '⚠ 已耗尽', urgency: 'critical' as const }

  const burn = props.burnRatePerHour
  if (!burn || burn <= 0 || !Number.isFinite(burn)) return null

  const remainingHours = (100 - rate) / burn
  if (!Number.isFinite(remainingHours) || remainingHours > 24) return null

  let text: string
  let urgency: 'safe' | 'warn' | 'critical'
  if (remainingHours < 2) {
    text = `⚠ ${formatHoursShort(remainingHours)}后用完`
    urgency = 'critical'
  } else if (remainingHours < 8) {
    text = `${formatHoursShort(remainingHours)}后用完`
    urgency = 'warn'
  } else {
    text = `${formatHoursShort(remainingHours)}后用完`
    urgency = 'safe'
  }
  return { text, urgency }
})

function formatHoursShort(hours: number): string {
  if (hours < 1) {
    return `${Math.max(1, Math.round(hours * 60))} 分钟`
  }
  if (hours < 10) {
    return `${hours.toFixed(1)} 小时`
  }
  return `${Math.round(hours)} 小时`
}

function formatReset(iso: string): string {
  if (!iso) return ''
  try {
    const d = new Date(iso)
    if (isNaN(d.getTime())) return ''
    const diff = Math.ceil((d.getTime() - Date.now()) / 60000)
    if (diff < 1440) {
      return d.toLocaleTimeString(locale.value, { hour: '2-digit', minute: '2-digit', hour12: false })
    }
    return d.toLocaleDateString(locale.value, { month: 'short', day: 'numeric' })
  } catch { return '' }
}
</script>

<style scoped>
.quota-card {
  padding: 8px 10px;
  background: var(--bg-card);
  border-radius: 8px;
  box-shadow: var(--shadow-card);
  transition: background 0.2s, box-shadow 0.2s;
}

.quota-card:hover {
  background: var(--bg-card-hover);
  box-shadow: var(--shadow-card-hover);
}

.card-top {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 5px;
}

.quota-label {
  font-weight: 600;
  font-size: 13px;
  color: var(--text-heading);
}

.quota-percent {
  font-weight: 700;
  font-size: 16px;
  font-variant-numeric: tabular-nums;
  color: var(--text-primary);
  transition: color 0.3s;
}
.quota-percent.yellow { color: var(--cqb-yellow-dark); }
.quota-percent.red    { color: var(--cqb-red-dark); }

.progress-bar {
  height: 6px;
  background: var(--border-subtle);
  border-radius: 3px;
  overflow: hidden;
  margin-bottom: 5px;
}

.progress-fill {
  height: 100%;
  border-radius: 3px;
  /* width 和 background 由 :style 动态绑定（HSL 渐变） */
  transition: width 0.5s cubic-bezier(0.4, 0, 0.2, 1);
}

.card-bottom {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 6px;
  min-height: 14px;
}

.reset-text {
  font-size: 10px;
  color: var(--text-tertiary);
}

/* === 预估爆仓时间 === */
.projection {
  font-size: 10px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.1px;
  white-space: nowrap;
  transition: color 0.3s;
}
.projection-safe     { color: var(--cqb-green); }
.projection-warn     { color: var(--cqb-yellow-dark); }
.projection-critical {
  color: var(--cqb-red-dark);
  animation: projection-blink 1.5s ease-in-out infinite;
}

@keyframes projection-blink {
  0%, 100% { opacity: 1; }
  50%      { opacity: 0.55; }
}

</style>
