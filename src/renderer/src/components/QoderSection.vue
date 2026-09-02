<!--
  Qoder 额度区块：合并主额度与共享额度后的单一卡片
  （百分比 + 已用/总量 credits 描述 + 重置倒计时，协议文档 §8）
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
      />
    </div>
    <div v-if="mainQuota" class="credits-desc">
      {{ descText }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import QuotaCard from './QuotaCard.vue'
import type { AccountUsageData } from '../types'

const props = defineProps<{
  account: AccountUsageData
}>()

const mainQuota = computed(() => props.account.quotas?.[0])

/** en_US 数字格式：整数不带小数位，非整数最多保留两位（协议文档 §8） */
function formatCredits(value: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value)
}

const descText = computed(() => {
  const q = mainQuota.value
  if (!q) return ''
  const unit = props.account.qoderUnit || 'credits'
  return `${formatCredits(q.used)} / ${formatCredits(q.total)} ${unit}`
})

</script>

<style scoped>
.quota-row {
  margin-bottom: 6px;
}

.credits-desc {
  font-size: 11px;
  color: var(--text-secondary);
  text-align: right;
  font-variant-numeric: tabular-nums;
  padding: 0 2px 2px;
}
</style>
