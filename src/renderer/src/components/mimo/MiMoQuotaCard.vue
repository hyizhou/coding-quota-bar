<!--
  MiMo 月度 Credits 额度卡：剩余百分比 + 进度条 + 重置倒计时，
  下方展开各模型 Token 换算估算明细。
-->
<template>
  <div class="credits-card">
    <div class="credits-top">
      <span class="credits-label">{{ $t(label) }}</span>
      <span class="credits-percent" :class="color">{{ Math.round(usageRate) }}%</span>
    </div>
    <div class="credits-bar">
      <div class="credits-fill" :class="color" :style="{ width: usageRate + '%' }"></div>
    </div>
    <div class="credits-bottom">
      <span class="credits-values">{{ formatCredits(used) }} / {{ formatCredits(total) }} Credits</span>
      <span class="credits-reset">{{ formatReset(resetAt) }}</span>
    </div>
    <div class="credits-detail">
      <div class="detail-header" :title="estimateTooltip">{{ t('quota.mimoEstimateTitle') }}</div>
      <div class="detail-model" v-for="m in modelEstimates" :key="m.name">
        <div class="detail-row">
          <span class="detail-label">{{ m.name }}</span>
          <span class="detail-value">{{ formatTokens(m.used) }} / {{ formatTokens(m.total) }}</span>
        </div>
        <div class="detail-bar"><div class="detail-bar-fill" :class="color" :style="{ width: usageRate + '%' }"></div></div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  label: string
  used: number
  total: number
  usageRate: number
  color: 'green' | 'yellow' | 'red'
  resetAt: string
}>()

const { t, locale } = useI18n()

// 模型定价（Credits/1M tokens），来源：src/providers/mimo-pricing.json
const MIMO_PRICING: Record<string, { cacheHit: number; cacheMiss: number; output: number }> = {
  'mimo-v2.5-pro': { cacheHit: 2.5, cacheMiss: 300, output: 600 },
  'mimo-v2.5':     { cacheHit: 2,   cacheMiss: 100, output: 200 },
}

const TOKEN_RATIO = { cache: 0.95, miss: 0.04, output: 0.01 }

const modelEstimates = computed(() =>
  Object.entries(MIMO_PRICING).map(([name, p]) => {
    const weightedPrice = TOKEN_RATIO.cache * p.cacheHit + TOKEN_RATIO.miss * p.cacheMiss + TOKEN_RATIO.output * p.output
    return {
      name,
      total: weightedPrice > 0 ? props.total / weightedPrice : 0,
      used: weightedPrice > 0 ? props.used / weightedPrice : 0,
    }
  })
)

const estimateTooltip = computed(() =>
  t('quota.mimoEstimateFormula', { cache: '95%', miss: '4%', output: '1%' })
)

function formatCredits(n: number): string {
  return n.toLocaleString()
}

function formatTokens(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`
  return `${Math.round(n)}`
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
.credits-card {
  padding: 8px 10px;
  background: var(--bg-card);
  border-radius: 8px;
  box-shadow: var(--shadow-card);
  transition: background 0.2s, box-shadow 0.2s;
  overflow: hidden;
}

.credits-card:hover {
  background: var(--bg-card-hover);
  box-shadow: var(--shadow-card-hover);
}

.credits-top {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 5px;
}

.credits-label {
  font-weight: 600;
  font-size: 13px;
  color: var(--text-heading);
}

.credits-percent {
  font-weight: 700;
  font-size: 16px;
  font-variant-numeric: tabular-nums;
  color: var(--text-primary);
}
.credits-percent.yellow { color: #a16207; }
.credits-percent.red { color: #dc2626; }

.credits-bar {
  height: 6px;
  background: var(--border-subtle);
  border-radius: 3px;
  overflow: hidden;
  margin-bottom: 5px;
}

.credits-fill {
  height: 100%;
  border-radius: 3px;
  transition: width 0.5s cubic-bezier(0.4, 0, 0.2, 1);
}
.credits-fill.green { background: linear-gradient(90deg, #4ade80, #22c55e); }
.credits-fill.yellow { background: linear-gradient(90deg, #facc15, #eab308); }
.credits-fill.red { background: linear-gradient(90deg, #f87171, #ef4444); }

.credits-bottom {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.credits-values {
  font-size: 11px;
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
}

.credits-reset {
  font-size: 10px;
  color: var(--text-tertiary);
}

.credits-detail {
  max-height: 0;
  opacity: 0;
  overflow: hidden;
  transition: max-height 0.3s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.25s ease, margin-top 0.3s ease;
  margin-top: 0;
}

.credits-card:hover .credits-detail {
  max-height: 140px;
  opacity: 1;
  margin-top: 8px;
}

.detail-header {
  font-size: 11px;
  color: var(--text-secondary);
  margin-bottom: 4px;
  cursor: help;
  border-bottom: 1px dashed var(--border-subtle);
  display: inline-block;
}

.detail-model {
  margin-bottom: 4px;
}

.detail-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1px 0;
}

.detail-label {
  font-size: 11px;
  color: var(--text-tertiary);
}

.detail-value {
  font-size: 11px;
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
}

.detail-bar {
  height: 3px;
  background: var(--border-subtle);
  border-radius: 1.5px;
  overflow: hidden;
}

.detail-bar-fill {
  height: 100%;
  border-radius: 1.5px;
  transition: width 0.4s cubic-bezier(0.4, 0, 0.2, 1);
}
.detail-bar-fill.green { background: linear-gradient(90deg, #4ade80, #22c55e); }
.detail-bar-fill.yellow { background: linear-gradient(90deg, #facc15, #eab308); }
.detail-bar-fill.red { background: linear-gradient(90deg, #f87171, #ef4444); }
</style>
