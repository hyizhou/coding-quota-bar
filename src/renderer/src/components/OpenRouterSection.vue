<template>
  <!-- OpenRouter 渠道：顶部账户余额卡 + 每个 API Key 一张自适应高度卡片（口径由卡片划分） -->

  <!-- 账户卡：账户级钱包信息，多 Key 共用同一余额 -->
  <div v-if="accountCard" class="account-card">
    <div class="account-main">
      <span class="card-label">{{ $t('quota.openrouterBalance') }}</span>
      <span class="balance-value">${{ accountCard.amount }}</span>
    </div>
    <div class="account-sub">
      {{ $t('quota.openrouterTotalCredits') }} ${{ accountCard.credits }} ·
      {{ $t('quota.openrouterTotalUsage') }} ${{ accountCard.usage }}
    </div>
  </div>

  <!-- Key 卡：一 Key 一卡，内容一致，高度随内容自适应 -->
  <div v-for="key in keyCards" :key="key.id" class="key-card">
    <div class="key-head">
      <span class="key-title">{{ key.title }}</span>
    </div>

    <div v-if="key.error" class="key-error">{{ formatError(key.error) }}</div>
    <template v-else>
      <div v-if="key.limit" class="limit-row">
        <QuotaCard v-bind="key.limit" />
      </div>
      <div v-else class="no-limit">{{ $t('quota.openrouterNoLimit') }}</div>

      <!-- 有效期/重置期：进度条下方小字，精确到分钟 -->
      <div v-if="key.expiry || key.reset" class="key-meta-row">
        <span v-if="key.expiry">{{ $t('quota.openrouterKeyExpiry') }} {{ key.expiry }}</span>
        <span v-if="key.reset">{{ $t('quota.openrouterResetDaily') }}</span>
      </div>

      <div v-if="key.spends.length" class="spend-row">
        <div v-for="s in key.spends" :key="s.label" class="spend-item">
          <span class="spend-label">{{ $t(s.label) }}</span>
          <span class="spend-value">${{ s.amount }}</span>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import QuotaCard from './QuotaCard.vue'
import type { AccountUsageData, QuotaItem } from '../types'

const { t, locale } = useI18n()

const props = defineProps<{
  accounts: AccountUsageData[]
}>()

/** 账户卡数据：余额为账户级，任一 Key 查询 /credits 返回相同，取第一个有数据的账户 */
const accountCard = computed(() => {
  for (const acc of props.accounts) {
    const q = acc.quotas.find(x => x.limitType === 'openrouter-balance')
    if (q) {
      const p = q.labelParams ?? {}
      return {
        amount: String(p.amount ?? '0.00'),
        credits: String(p.credits ?? '0.00'),
        usage: String(p.usage ?? '0.00'),
      }
    }
  }
  return null
})

interface KeyCard {
  id: string
  title: string
  expiry: string
  reset: boolean
  error?: string
  limit?: QuotaItem
  spends: Array<{ label: string; amount: string }>
}

const SPEND_DEFS = [
  { type: 'openrouter-daily', label: 'quota.openrouterDailyUsage' },
  { type: 'openrouter-weekly', label: 'quota.openrouterWeeklyUsage' },
  { type: 'openrouter-monthly', label: 'quota.openrouterMonthlyUsage' },
] as const

const keyCards = computed<KeyCard[]>(() =>
  props.accounts.map((acc, idx) => {
    const limit = acc.quotas.find(q => q.limitType === 'openrouter-key-limit')
    const expiry = acc.quotas.find(q => q.limitType === 'openrouter-expiry')
    return {
      id: acc.id,
      title: acc.label || t('quota.openrouterKeyTitle', { n: idx + 1 }),
      expiry: expiry ? formatDateTime(expiry.resetAt) : '',
      reset: limit?.labelParams?.reset === 'daily',
      error: acc.error,
      limit,
      spends: SPEND_DEFS
        .map((d): { label: string; amount: string } | null => {
          const q = acc.quotas.find(x => x.limitType === d.type)
          return q ? { label: d.label, amount: String(q.labelParams?.amount ?? '0.00') } : null
        })
        .filter((x): x is { label: string; amount: string } => !!x),
    }
  })
)

function formatDateTime(iso: string): string {
  if (!iso) return ''
  try {
    const d = new Date(iso)
    if (isNaN(d.getTime())) return iso
    return d.toLocaleString(locale.value, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
  } catch {
    return iso
  }
}

function formatError(error: string): string {
  return error.replace(/^\[[\w]+\]\s*/, '')
}
</script>

<style scoped>
.account-card,
.key-card {
  padding: 10px 12px;
  background: var(--bg-card);
  border-radius: 8px;
  box-shadow: var(--shadow-card);
  margin-bottom: 6px;
  transition: background 0.2s, box-shadow 0.2s;
}

.account-card:hover,
.key-card:hover {
  background: var(--bg-card-hover);
  box-shadow: var(--shadow-card-hover);
}

.account-main {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
}

.card-label {
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

.account-sub {
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px solid var(--border-subtle);
  font-size: 10px;
  color: var(--text-tertiary);
  font-variant-numeric: tabular-nums;
}

.key-head {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
  margin-bottom: 8px;
}

.key-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-heading);
  margin-right: 4px;
}

.key-error {
  font-size: 12px;
  color: var(--text-error);
  line-height: 1.4;
}

.limit-row {
  margin-bottom: 4px;
}

.no-limit {
  font-size: 11px;
  color: var(--text-tertiary);
  margin-bottom: 4px;
}

.key-meta-row {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin: 0 0 8px 2px;
  font-size: 10px;
  color: var(--text-tertiary);
  font-variant-numeric: tabular-nums;
}

.key-meta-row span + span::before {
  content: '·';
  margin-right: 4px;
}

.spend-row {
  display: flex;
  gap: 6px;
  padding-top: 8px;
  border-top: 1px solid var(--border-subtle);
}

.spend-item {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.spend-label {
  font-size: 10px;
  font-weight: 600;
  color: var(--text-tertiary);
}

.spend-value {
  font-size: 13px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--text-primary);
}
</style>
