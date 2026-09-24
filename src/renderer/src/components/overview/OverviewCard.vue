<!--
  单张总览卡片：纯展示组件，指标数据由 overview-metrics 构建；
  拖拽与点击事件由父组件经单根 fallthrough 接线到根 button。
-->
<template>
  <button
    type="button"
    class="overview-card"
    :class="{
      'has-error': !!card.account.error,
      dragging,
      'drop-above': dropAbove,
      'drop-below': dropBelow,
    }"
  >
    <div class="card-head">
      <div class="provider-title">
        <span class="provider-name">{{ card.provider.name }}</span>
        <span v-if="card.accountLabel" class="account-label">{{ card.accountLabel }}</span>
      </div>
      <span class="metric-value" :class="card.primary.color">{{ card.primary.value }}</span>
    </div>

    <template v-if="card.account.error">
      <div class="error-line">{{ formatError(card.account.error) }}</div>
    </template>
    <template v-else>
      <div class="metric-line">
        <span class="metric-label">{{ card.primary.label }}</span>
        <span class="metric-detail">{{ card.primary.detail }}</span>
      </div>
      <div v-if="!card.primary.hideBar" class="overview-bar">
        <div class="overview-fill" :class="card.primary.color" :style="{ width: `${card.primary.usageRate}%` }"></div>
      </div>
      <div v-if="card.secondary.length > 0" class="secondary-list">
        <span v-for="item in card.secondary" :key="item.label" class="secondary-chip">
          <span class="chip-label">{{ item.label }}</span>
          <span class="chip-value" :class="item.color">{{ item.value }}</span>
        </span>
      </div>
    </template>
  </button>
</template>

<script setup lang="ts">
import { formatError, type OverviewCard as OverviewCardData } from './overview-metrics'

defineProps<{
  card: OverviewCardData
  dragging: boolean
  dropAbove: boolean
  dropBelow: boolean
}>()
</script>

<style scoped>
.overview-card {
  position: relative;
  width: 100%;
  display: block;
  padding: 9px 10px;
  border: none;
  border-radius: 8px;
  background: var(--bg-card);
  box-shadow: var(--shadow-card);
  color: inherit;
  text-align: left;
  cursor: pointer;
  transition: background 0.15s, box-shadow 0.15s, transform 0.15s;
}

.overview-card:hover {
  background: var(--bg-card-hover);
  box-shadow: var(--shadow-card-hover);
}

.overview-card:active {
  transform: translateY(1px);
}

.overview-card.dragging {
  opacity: 0.45;
}

/* 组边界插入指示线：落在 7px 卡片间距中央 */
.overview-card.drop-above::before,
.overview-card.drop-below::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  height: 2px;
  background: #3b82f6;
  border-radius: 1px;
}

.overview-card.drop-above::before {
  top: -4px;
}

.overview-card.drop-below::after {
  bottom: -4px;
}

.card-head,
.metric-line {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
}

.provider-title {
  min-width: 0;
  display: flex;
  align-items: baseline;
  gap: 6px;
}

.provider-name {
  font-size: 13px;
  font-weight: 700;
  color: var(--text-heading);
  white-space: nowrap;
}

.account-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 10px;
  color: var(--text-tertiary);
}

.metric-value {
  flex-shrink: 0;
  max-width: 45%;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 18px;
  line-height: 1;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  color: var(--text-primary);
}

.metric-value.yellow,
.chip-value.yellow {
  color: #a16207;
}

.metric-value.red,
.chip-value.red {
  color: #dc2626;
}

.metric-value.green,
.chip-value.green {
  color: var(--text-primary);
}

.metric-line {
  margin-top: 5px;
}

.metric-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
}

.metric-detail {
  flex-shrink: 0;
  max-width: 58%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 10px;
  color: var(--text-tertiary);
  font-variant-numeric: tabular-nums;
}

.overview-bar {
  height: 5px;
  margin-top: 6px;
  background: var(--border-subtle);
  border-radius: 3px;
  overflow: hidden;
}

.overview-fill {
  height: 100%;
  border-radius: 3px;
  transition: width 0.35s cubic-bezier(0.4, 0, 0.2, 1);
}

/* 与智谱 QuotaCard 同款配色 */
.overview-fill.green { background: linear-gradient(90deg, #4ade80, #22c55e); }
.overview-fill.yellow { background: linear-gradient(90deg, #facc15, #eab308); }
.overview-fill.red { background: linear-gradient(90deg, #f87171, #ef4444); }

.secondary-list {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin-top: 7px;
}

.secondary-chip {
  min-width: 0;
  display: inline-flex;
  align-items: baseline;
  gap: 4px;
  padding: 3px 6px;
  border-radius: 5px;
  background: var(--bg-tab-bar);
  font-size: 10px;
  color: var(--text-tertiary);
}

.chip-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chip-value {
  flex-shrink: 0;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--text-secondary);
}

.error-line {
  margin-top: 6px;
  font-size: 11px;
  line-height: 1.35;
  color: var(--text-error);
}
</style>
