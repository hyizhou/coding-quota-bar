<!--
  Qoder 额度区块：合并主额度与共享额度后的单一卡片
  （百分比 + 卡片内已用/剩余 credits + 重置倒计时，协议文档 §8）
  下方依次展示可切换时间范围的 Credits 消耗折线图与近一年 Credits 热力图
-->
<template>
  <div>
    <div v-for="(quota, idx) in account.quotas" :key="idx" class="quota-row">
      <QuotaCard
        :label="quota.label"
        :label-params="quota.labelParams"
        :usage-rate="quota.usageRate"
        :reset-at="quota.resetAt"
        :color="quota.color"
        :info-text="quotaInfoText(quota)"
      />
    </div>
    <QoderCreditsTrendChart
      v-if="account.qoderCreditsTrend?.points.length"
      :trend="account.qoderCreditsTrend"
    />
    <div v-if="account.qoderCreditsHeatmap?.items.length" class="heatmap-card">
      <div class="heatmap-header">
        <span class="heatmap-title">{{ $t('main.qoderCreditsHeatmap') }}</span>
        <span class="heatmap-total">{{ formatCredits(account.qoderCreditsHeatmap.total) }}</span>
      </div>
      <UsageHeatmap
        :records="account.qoderCreditsHeatmap.items"
        :format-value="formatHeatmapValue"
        compact
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { defineAsyncComponent } from 'vue'
import { useI18n } from 'vue-i18n'
import QuotaCard from '../QuotaCard.vue'
import UsageHeatmap from '../UsageHeatmap.vue'
import type { AccountUsageData } from '../../types'

// chart.js 体积较大，Qoder 页签打开时再加载折线图 chunk
const QoderCreditsTrendChart = defineAsyncComponent(() => import('./QoderCreditsTrendChart.vue'))

const props = defineProps<{
  account: AccountUsageData
}>()

const { t } = useI18n()

/** en_US 数字格式：整数不带小数位，非整数最多保留两位（协议文档 §8） */
function formatCredits(value: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value)
}

/** 额度卡左下角信息：已用 / 剩余 */
function quotaInfoText(quota: { used: number; total: number }): string {
  const remaining = props.account.qoderRemaining ?? Math.max(0, quota.total - quota.used)
  const unit = props.account.qoderUnit || 'credits'
  return `${t('main.qoderUsed')} ${formatCredits(quota.used)} / ${t('main.qoderRemaining')} ${formatCredits(remaining)} ${unit}`
}

function formatHeatmapValue(value: number): string {
  return `${formatCredits(value)} credits`
}

</script>

<style scoped>
.quota-row {
  margin-bottom: 6px;
}

.heatmap-card {
  padding: 6px 10px;
  background: var(--bg-card);
  border-radius: 8px;
  box-shadow: var(--shadow-card);
  transition: background 0.2s, box-shadow 0.2s;
}

.heatmap-card:hover {
  background: var(--bg-card-hover);
  box-shadow: var(--shadow-card-hover);
}

.heatmap-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
}

.heatmap-title {
  font-size: 10px;
  font-weight: 600;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.heatmap-total {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}
</style>
