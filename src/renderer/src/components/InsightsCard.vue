<template>
  <div v-if="insights.length > 0" class="insights-card">
    <div class="insights-header">
      <span class="insights-title">📊 洞察</span>
    </div>
    <ul class="insights-list">
      <li v-for="(item, i) in insights" :key="i" class="insight-row" :class="`insight-${item.kind}`">
        <span class="insight-icon">{{ item.icon }}</span>
        <span class="insight-text">
          <strong>{{ item.label }}</strong>
          <span v-if="item.delta" class="insight-delta" :class="`delta-${item.delta.kind}`">
            {{ item.delta.text }}
          </span>
        </span>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { ModelTokenRecord, UsageRecord } from '../types'

const props = defineProps<{
  /** 过去 30 天的 token 使用历史（按日期升序），用于周对比 */
  history30d: UsageRecord[]
  /** 过去 1 天按模型的 token 使用记录，用于主力模型/高峰时段 */
  modelHistory1d: ModelTokenRecord[]
}>()

type Delta = { kind: 'up' | 'down' | 'flat'; text: string }
type Insight = {
  icon: string
  label: string
  kind: 'good' | 'bad' | 'neutral'
  delta?: Delta
}

/**
 * 全部洞察从 props 数据确定性计算得出（不调 LLM）
 * 输出：与上周对比、主力模型、高峰时段
 */
const insights = computed<Insight[]>(() => {
  const out: Insight[] = []

  // 1. 与上周同期对比（用 30d 数据）
  const weekCompare = compareWeekOverWeek30(props.history30d)
  if (weekCompare) out.push(weekCompare)

  // 2. 主力模型（按 token 数）
  const topModel = findTopModel(props.modelHistory1d)
  if (topModel) out.push(topModel)

  // 3. 高峰时段（过去 1 天的模型历史）
  const peakHour = findPeakHour(props.modelHistory1d)
  if (peakHour) out.push(peakHour)

  return out
})

/**
 * 30 天数据分两半对比：近 7 天 vs 前 7 天
 */
function compareWeekOverWeek30(history30: UsageRecord[]): Insight | null {
  if (!history30 || history30.length < 14) return null
  const sorted = [...history30].sort((a, b) => a.date.localeCompare(b.date))
  const recentWeek = sorted.slice(-7)
  const prevWeek = sorted.slice(-14, -7)
  if (recentWeek.length === 0 || prevWeek.length === 0) return null
  const recentTotal = recentWeek.reduce((s, r) => s + r.used, 0)
  const prevTotal = prevWeek.reduce((s, r) => s + r.used, 0)
  if (prevTotal === 0) {
    if (recentTotal === 0) return null
    return {
      icon: '📈',
      label: '本周开始使用',
      kind: 'neutral',
    }
  }
  const change = ((recentTotal - prevTotal) / prevTotal) * 100
  const absChange = Math.abs(Math.round(change))
  if (absChange < 5) {
    return {
      icon: '➡️',
      label: '本周用量持平',
      kind: 'neutral',
      delta: { kind: 'flat', text: '与上周基本一致' },
    }
  }
  if (change > 0) {
    return {
      icon: '📈',
      label: `本周比上周 ↑ ${absChange}%`,
      kind: 'bad',
      delta: { kind: 'up', text: `${formatTokens(recentTotal - prevTotal)} 多` },
    }
  } else {
    return {
      icon: '📉',
      label: `本周比上周 ↓ ${absChange}%`,
      kind: 'good',
      delta: { kind: 'down', text: `${formatTokens(prevTotal - recentTotal)} 少` },
    }
  }
}

/**
 * 主力模型：过去 1 天 token 最多的模型
 */
function findTopModel(records: ModelTokenRecord[]): Insight | null {
  if (!records || records.length === 0) return null
  const totals = new Map<string, number>()
  for (const r of records) {
    totals.set(r.model, (totals.get(r.model) ?? 0) + r.used)
  }
  // 排序取 Top 1
  const sorted = Array.from(totals.entries()).sort((a, b) => b[1] - a[1])
  if (sorted.length === 0) return null
  const [topModel, topTokens] = sorted[0]
  const grandTotal = sorted.reduce((s, [, v]) => s + v, 0)
  const percent = grandTotal > 0 ? Math.round((topTokens / grandTotal) * 100) : 0
  return {
    icon: '🏆',
    label: `主力模型: ${topModel} (${percent}%)`,
    kind: 'neutral',
  }
}

/**
 * 高峰时段：过去 1 天累计 token 最多的小时
 * 判定条件：top1 至少占总用量的 30%，避免「完全平摊」时误报
 * （3 个小时均匀分布时 top1 = 33% 也算"勉强"高峰，所以选 30% 阈值）
 */
function findPeakHour(records: ModelTokenRecord[]): Insight | null {
  if (!records || records.length === 0) return null
  const hourly = new Map<string, number>()
  for (const r of records) {
    // date 格式 'YYYY-MM-DDTHH'，取 HH 部分
    const hour = r.date.includes('T') ? r.date.split('T')[1] : r.date.slice(-2)
    if (!hour || !/^\d{2}$/.test(hour)) continue
    hourly.set(hour, (hourly.get(hour) ?? 0) + r.used)
  }
  if (hourly.size === 0) return null
  const sorted = Array.from(hourly.entries()).sort((a, b) => b[1] - a[1])
  const [peakHourStr, peakTokens] = sorted[0]
  const grandTotal = sorted.reduce((s, [, v]) => s + v, 0)
  if (grandTotal <= 0) return null
  const peakRatio = peakTokens / grandTotal
  // 至少 30% 才算"明显高峰"
  if (peakRatio < 0.3) return null
  const percent = Math.round(peakRatio * 100)
  return {
    icon: '⏰',
    label: `高峰时段: ${peakHourStr}:00 (${percent}%)`,
    kind: 'neutral',
  }
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M tok`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K tok`
  return `${n} tok`
}
</script>

<style scoped>
.insights-card {
  background: var(--bg-card);
  border-radius: 8px;
  box-shadow: var(--shadow-card);
  padding: 8px 10px;
  margin-bottom: 8px;
  transition: background 0.2s, box-shadow 0.2s;
}

.insights-card:hover {
  background: var(--bg-card-hover);
  box-shadow: var(--shadow-card-hover);
}

.insights-header {
  margin-bottom: 4px;
}

.insights-title {
  font-size: 12px;
  font-weight: 700;
  color: var(--text-heading);
}

.insights-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.insight-row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--text-secondary);
  line-height: 1.4;
}

.insight-icon {
  font-size: 11px;
  flex-shrink: 0;
}

.insight-text {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: baseline;
  gap: 6px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.insight-text strong {
  font-weight: 600;
  color: var(--text-primary);
}

.insight-good .insight-text strong { color: var(--cqb-green); }
.insight-bad  .insight-text strong { color: var(--cqb-yellow-dark); }

.insight-delta {
  font-size: 10px;
  color: var(--text-tertiary);
  font-variant-numeric: tabular-nums;
}
.delta-up   { color: var(--cqb-yellow-dark); }
.delta-down { color: var(--cqb-green); }
.delta-flat { color: var(--text-tertiary); }
</style>
