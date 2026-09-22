<!--
  通用账户余额卡：标题 + 余额大数字 + 可选明细行（赠款/现金/冻结等）。
  明细行由调用方按业务显隐规则组装为 items，muted 行用最弱文字色弱化展示。
-->
<template>
  <div class="balance-card card">
    <div class="balance-header">
      <span class="balance-label">{{ label }}</span>
      <span class="balance-value">{{ value }}</span>
    </div>
    <div class="balance-detail" v-if="items?.length">
      <span
        v-for="(item, idx) in items"
        :key="idx"
        class="balance-item"
        :class="{ muted: item.muted }"
      >{{ item.label }} {{ item.value }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
/** 单条余额明细（label/value 由调用方完成格式化与币种符号拼接） */
export interface BalanceCardItem {
  label: string
  value: string
  /** 弱化展示（如冻结金额，不可用余额） */
  muted?: boolean
}

defineProps<{
  label: string
  value: string
  items?: BalanceCardItem[]
}>()
</script>

<style scoped>
.balance-card {
  margin-bottom: 6px;
}

.balance-header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
}

.balance-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-heading);
}

.balance-value {
  font-size: 20px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--text-primary);
}

.balance-detail {
  display: flex;
  gap: 10px;
  margin-top: 4px;
}

.balance-item {
  font-size: 11px;
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
}

.balance-item.muted {
  color: var(--text-tertiary);
}
</style>
