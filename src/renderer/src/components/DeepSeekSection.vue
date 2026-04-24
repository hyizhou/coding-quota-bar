<template>
  <div class="balance-card">
    <div class="balance-header">
      <span class="balance-label">{{ $t('quota.deepseekTotalBalance') }}</span>
      <span class="balance-value">¥{{ totalBalance.toFixed(2) }}</span>
    </div>
    <div v-if="hasDetails" class="balance-details">
      <span v-for="d in details" :key="d.label" class="detail-item">
        {{ $t(d.label) }}: ¥{{ d.amount }}
      </span>
    </div>
    <template v-if="hasBudget">
      <div class="progress-bar">
        <div class="progress-fill" :class="barColor" :style="{ width: budgetRate + '%' }"></div>
      </div>
      <div class="budget-info">
        <span class="budget-hint">{{ $t('main.budgetRemaining', { n: budgetRemaining.toFixed(2) }) }}</span>
      </div>
    </template>
    <div class="budget-set-row">
      <span class="budget-set-label">¥</span>
      <input
        type="text"
        inputmode="decimal"
        class="budget-inline-input"
        :value="budget"
        @change="onBudgetChange"
        @blur="onBudgetChange"
        placeholder="设置总额度"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import type { AccountUsageData } from '../types'

const props = defineProps<{
  account: AccountUsageData
}>()

const budget = ref<number | undefined>(undefined)

onMounted(async () => {
  const config = await window.electronAPI.getConfig()
  if (config?.providers?.deepseek) {
    const acc = config.providers.deepseek.accounts?.find((a: any) => a.id === props.account.id)
    if (acc && (acc as any).budget != null) {
      budget.value = (acc as any).budget
    }
  }
})

const totalBalance = computed(() => {
  const q = props.account.quotas.find(q => q.label === 'quota.deepseekTotalBalance')
  return q?.total ?? 0
})

const hasBudget = computed(() => budget.value != null && budget.value > 0)

const budgetRate = computed(() => {
  if (!budget.value || budget.value <= 0) return 0
  return Math.min(100, Math.round((totalBalance.value / budget.value) * 100))
})

const budgetRemaining = computed(() => {
  if (!budget.value) return 0
  return Math.max(0, budget.value - totalBalance.value)
})

const barColor = computed(() => {
  const r = budgetRate.value
  if (r > 50) return 'green'
  if (r > 20) return 'yellow'
  return 'red'
})

const details = computed(() => {
  return props.account.quotas
    .filter(q => q.label !== 'quota.deepseekTotalBalance')
    .map(q => ({ label: q.label, amount: q.total.toFixed(2) }))
})

const hasDetails = computed(() => details.value.length > 0)

async function onBudgetChange(e: Event) {
  const input = e.target as HTMLInputElement
  const raw = input.value.trim()
  const val = raw ? parseFloat(raw) : undefined
  budget.value = val && val > 0 ? val : undefined
  input.value = budget.value != null ? String(budget.value) : ''

  const config = await window.electronAPI.getConfig()
  if (!config) return
  const providers = { ...config.providers }
  const ds = { ...providers.deepseek }
  const accounts = [...(ds.accounts || [])]
  const idx = accounts.findIndex((a: any) => a.id === props.account.id)
  if (idx >= 0) {
    accounts[idx] = { ...accounts[idx], budget: budget.value }
  }
  ds.accounts = accounts
  providers.deepseek = ds
  await window.electronAPI.updateConfig({ providers })
}
</script>

<style scoped>
.balance-card {
  padding: 10px 12px;
  background: var(--bg-card);
  border-radius: 10px;
  box-shadow: var(--shadow-card);
  transition: background 0.2s, box-shadow 0.2s;
}

.balance-card:hover {
  background: var(--bg-card-hover);
  box-shadow: var(--shadow-card-hover);
}

.balance-header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
}

.balance-label {
  font-weight: 600;
  font-size: 13px;
  color: var(--text-heading);
}

.balance-value {
  font-weight: 700;
  font-size: 20px;
  font-variant-numeric: tabular-nums;
  color: var(--text-primary);
}

.balance-details {
  display: flex;
  gap: 12px;
  margin-top: 6px;
}

.detail-item {
  font-size: 11px;
  color: var(--text-tertiary);
}

.progress-bar {
  height: 6px;
  background: var(--border-subtle);
  border-radius: 3px;
  overflow: hidden;
  margin-top: 8px;
}

.progress-fill {
  height: 100%;
  border-radius: 3px;
  transition: width 0.5s cubic-bezier(0.4, 0, 0.2, 1);
}

.progress-fill.green { background: linear-gradient(90deg, #4ade80, #22c55e); }
.progress-fill.yellow { background: linear-gradient(90deg, #facc15, #eab308); }
.progress-fill.red { background: linear-gradient(90deg, #f87171, #ef4444); }

.budget-info {
  display: flex;
  justify-content: flex-end;
  margin-top: 4px;
}

.budget-hint {
  font-size: 10px;
  color: var(--text-tertiary);
}

.budget-set-row {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--border-subtle);
}

.budget-set-label {
  font-size: 11px;
  color: var(--text-tertiary);
}

.budget-inline-input {
  flex: 1;
  padding: 2px 4px;
  font-size: 11px;
  color: var(--text-secondary);
  background: transparent;
  border: none;
  border-bottom: 1px dashed var(--border-subtle);
  border-radius: 0;
  outline: none;
  font-variant-numeric: tabular-nums;
  transition: border-color 0.15s;
}

.budget-inline-input::placeholder {
  color: var(--text-tertiary);
  font-size: 10px;
}

.budget-inline-input:focus {
  border-bottom-color: var(--border-default);
  border-bottom-style: solid;
}
</style>
