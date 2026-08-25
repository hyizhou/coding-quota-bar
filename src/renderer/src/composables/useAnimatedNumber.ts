import { ref, watch, computed, onUnmounted, type Ref } from 'vue'

/**
 * 数字平滑过渡 composable
 *
 * 当 target 值变化时，currentValue 用 requestAnimationFrame + easeOutCubic
 * 平滑过渡到目标值。duration 控制动画时长（ms）。
 *
 * 用法：
 *   const display = useAnimatedNumber(() => props.value)
 *   // template: {{ display.formatted }} ↑↓
 *
 * 特性：
 *  - 多次变化时取最新目标（不会叠加延迟）
 *  - 组件卸载自动 cancelAnimationFrame
 *  - 提供 trend 字段（up/down/same）方便 UI 显示箭头
 */

export type Trend = 'up' | 'down' | 'same'

export function useAnimatedNumber(
  source: Ref<number> | (() => number),
  options: { duration?: number; decimals?: number } = {}
) {
  const { duration = 400, decimals = 2 } = options

  // 接受 ref 或 getter
  const getTarget = (): number => {
    if (typeof source === 'function') return source()
    return (source as Ref<number>).value
  }

  const initial = getTarget()
  const value = ref(initial)
  const trend = ref<Trend>('same')

  let rafId: number | null = null
  let startTime: number | null = null
  let startValue = initial
  let targetValue = initial

  function easeOutCubic(t: number): number {
    return 1 - Math.pow(1 - t, 3)
  }

  function tick(now: number) {
    if (startTime === null) startTime = now
    const elapsed = now - startTime
    const progress = Math.min(elapsed / duration, 1)
    const eased = easeOutCubic(progress)
    value.value = startValue + (targetValue - startValue) * eased
    if (progress < 1) {
      rafId = requestAnimationFrame(tick)
    } else {
      value.value = targetValue
      rafId = null
      startTime = null
    }
  }

  function startAnimation(to: number) {
    if (rafId !== null) {
      cancelAnimationFrame(rafId)
      rafId = null
    }
    if (value.value === to) {
      trend.value = 'same'
      return
    }
    trend.value = to > value.value ? 'up' : 'down'
    startValue = value.value
    targetValue = to
    startTime = null
    rafId = requestAnimationFrame(tick)
  }

  watch(
    () => getTarget(),
    (newVal) => {
      startAnimation(newVal)
    },
    { flush: 'post' }
  )

  onUnmounted(() => {
    if (rafId !== null) cancelAnimationFrame(rafId)
  })

  const formatted = computed(() => value.value.toFixed(decimals))

  return { value, trend, formatted, decimals }
}
