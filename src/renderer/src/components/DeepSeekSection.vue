<template>
  <div v-if="budgetQuota" class="quota-row-single">
    <QuotaCard v-bind="budgetQuota" />
  </div>
  <div v-for="(q, i) in detailQuotas" :key="i" class="quota-row-single">
    <QuotaCard v-bind="q" />
  </div>
  <div class="budget-input-row">
    <input
      type="number"
      class="budget-inline-input"
      :value="budget"
      @change="onBudgetChange"
      :placeholder="$t('main.setBudget')"
      min="0"
      step="0.01"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import QuotaCard from './QuotaCard.vue'
import type { AccountUsageData, QuotaItem } from '../types'

const props = defineProps<{
  account: AccountUsageData
}>()

const { t } = useI18n()
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

const budgetQuota = computed<QuotaItem | null>(() => {
  if (!budget.value || budget.value <= 0) return null
  const bal = totalBalance.value
  const bgt = budget.value
  const remaining = Math.max(0, bgt - bal)
  const rate = bgt > 0 ? Math.min(100, Math.round((bal / bgt) * 100)) : 0
  const color = rate > 50 ? 'green' as const : rate > 20 ? 'yellow' as const : 'red' as const
  return {
    label: 'quota.deepseekTotalBalance',
    used: remaining,
    total: bgt,
    usageRate: rate,
    resetAt: '',
    color,
    labelParams: { amount: bal.toFixed(2) },
  }
})

const detailQuotas = computed(() => {
  return props.account.quotas.filter(q => {
    if (q.label === 'quota.deepseekTotalBalance') return false
    return true
  })
})

async function onBudgetChange(e: Event) {
  const input = e.target as HTMLInputElement
  const val = input.value ? parseFloat(input.value) : undefined
  budget.value = val && val > 0 ? val : undefined

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
.quota-row-single {
  margin-bottom: 6px;
}

.budget-input-row {
  margin-top: 6px;
}

.budget-inline-input {
  width: 100%;
  padding: 4px 8px;
  font-size: 11px;
  color: var(--text-secondary);
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: 6px;
  outline: none;
  box-sizing: border-box;
  transition: border-color 0.15s;
}

.budget-inline-input::placeholder {
  color: var(--text-tertiary);
}

.budget-inline-input:focus {
  border-color: var(--border-default);
}
</style>
