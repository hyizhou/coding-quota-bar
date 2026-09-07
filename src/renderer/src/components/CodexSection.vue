<template>
  <!-- 限流警告（页面顶部） -->
  <div v-if="account.limitReached" class="limit-warning">
    <span class="warning-icon">!</span>
    <span class="warning-text">{{ $t('quota.codexLimitReached') }}</span>
  </div>

  <!-- 主窗口 / 次窗口 QuotaCard 各占一行 -->
  <div v-for="q in windowQuotas" :key="q.label" class="quota-row-single">
    <QuotaCard v-bind="q" />
  </div>

  <!-- 额外限额（spark / 分模型专项额度） -->
  <div v-for="q in extraQuotas" :key="extraKey(q)" class="quota-row-single">
    <QuotaCard v-bind="q" />
  </div>

  <!-- 代码审查额度（可选） -->
  <div v-for="q in reviewQuotas" :key="q.label" class="quota-row-single">
    <QuotaCard v-bind="q" />
  </div>

  <!-- 余额卡片 -->
  <div v-if="creditItem" class="credits-card">
    <span class="credits-label">{{ $t(creditItem.label) }}</span>
    <span class="credits-value">${{ creditItem.used.toFixed(2) }}</span>
  </div>

  <!-- 订阅到期（可选） -->
  <div v-if="subscriptionItem" class="info-card">
    <span class="info-label">{{ $t('quota.codexSubscriptionUntil') }}</span>
    <span class="info-value">{{ formatDate(subscriptionItem.resetAt) }}</span>
  </div>

  <!-- 限流重置信用（可选） -->
  <div v-if="resetCreditItem" class="info-card">
    <span class="info-label">{{ $t('quota.codexResetCredits') }}</span>
    <span class="info-value">
      {{ $t('quota.codexResetCreditsCount', { n: resetCreditItem.used }) }}<template v-if="resetCreditItem.resetAt"> · {{ formatDate(resetCreditItem.resetAt) }}</template>
    </span>
  </div>

  <!-- 使用统计（可选） -->
  <div v-if="stats" class="stats-card">
    <div class="stats-title">{{ $t('quota.codexStatsTitle') }}</div>
    <div class="stats-grid">
      <div class="stats-item">
        <span class="stats-label">{{ $t('quota.codexStatsToday') }}</span>
        <span class="stats-value">{{ formatTokens(stats.todayTokens) }}</span>
      </div>
      <div class="stats-item">
        <span class="stats-label">{{ $t('quota.codexStatsYesterday') }}</span>
        <span class="stats-value">{{ formatTokens(stats.yesterdayTokens) }}</span>
      </div>
      <div class="stats-item">
        <span class="stats-label">{{ $t('quota.codexStatsLast30d') }}</span>
        <span class="stats-value">{{ formatTokens(stats.last30dTokens) }}</span>
      </div>
      <div v-if="stats.lifetimeTokens != null" class="stats-item">
        <span class="stats-label">{{ $t('quota.codexStatsLifetime') }}</span>
        <span class="stats-value">{{ formatTokens(stats.lifetimeTokens) }}</span>
      </div>
      <div v-if="stats.peakDailyTokens != null" class="stats-item">
        <span class="stats-label">{{ $t('quota.codexStatsPeakDaily') }}</span>
        <span class="stats-value">{{ formatTokens(stats.peakDailyTokens) }}</span>
      </div>
      <div v-if="stats.currentStreakDays != null" class="stats-item">
        <span class="stats-label">{{ $t('quota.codexStatsCurrentStreak') }}</span>
        <span class="stats-value">{{ $t('quota.codexStatsDays', { n: stats.currentStreakDays }) }}</span>
      </div>
      <div v-if="stats.longestStreakDays != null" class="stats-item">
        <span class="stats-label">{{ $t('quota.codexStatsLongestStreak') }}</span>
        <span class="stats-value">{{ $t('quota.codexStatsDays', { n: stats.longestStreakDays }) }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import QuotaCard from './QuotaCard.vue'
import type { AccountUsageData } from '../types'

const { locale } = useI18n()

const props = defineProps<{
  account: AccountUsageData
}>()

const windowQuotas = computed(() =>
  props.account.quotas.filter(q => q.limitType === 'codex')
)

const extraQuotas = computed(() =>
  props.account.quotas.filter(q => q.limitType === 'codex-extra' || q.limitType === 'codex-spark')
)

const reviewQuotas = computed(() =>
  props.account.quotas.filter(q => q.limitType === 'codex-review')
)

const creditItem = computed(() =>
  props.account.quotas.find(q => q.limitType === 'codex-credits')
)

const subscriptionItem = computed(() =>
  props.account.quotas.find(q => q.limitType === 'codex-subscription')
)

const resetCreditItem = computed(() =>
  props.account.quotas.find(q => q.limitType === 'codex-reset-credits')
)

const stats = computed(() => props.account.codexStats)

function extraKey(q: { label: string; labelParams?: Record<string, string | number> }): string {
  return `${q.label}:${q.labelParams?.name ?? ''}`
}

function formatTokens(n: number): string {
  return new Intl.NumberFormat(locale.value, { notation: 'compact', maximumFractionDigits: 1 }).format(n)
}

function formatDate(iso: string): string {
  if (!iso) return ''
  try {
    const d = new Date(iso)
    if (isNaN(d.getTime())) return iso
    return d.toLocaleDateString(locale.value, { year: 'numeric', month: 'short', day: 'numeric' })
  } catch {
    return iso
  }
}
</script>

<style scoped>
.limit-warning {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  background: var(--bg-error);
  border: 1px solid var(--border-error);
  border-radius: 8px;
  margin-bottom: 6px;
}

.warning-icon {
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: #ef4444;
  color: #fff;
  font-size: 12px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
}

.warning-text {
  font-size: 12px;
  color: var(--text-error);
  line-height: 1.4;
}

.quota-row-single {
  margin-bottom: 6px;
}

.credits-card {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  padding: 8px 10px;
  background: var(--bg-card);
  border-radius: 8px;
  box-shadow: var(--shadow-card);
  margin-bottom: 6px;
  transition: background 0.2s, box-shadow 0.2s;
}

.credits-card:hover {
  background: var(--bg-card-hover);
  box-shadow: var(--shadow-card-hover);
}

.credits-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-heading);
}

.credits-value {
  font-size: 18px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--text-primary);
}

.info-card {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  padding: 8px 10px;
  background: var(--bg-card);
  border-radius: 8px;
  box-shadow: var(--shadow-card);
  margin-bottom: 6px;
  transition: background 0.2s, box-shadow 0.2s;
}

.info-card:hover {
  background: var(--bg-card-hover);
  box-shadow: var(--shadow-card-hover);
}

.info-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-heading);
}

.info-value {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-secondary);
}

.stats-card {
  padding: 10px 12px;
  background: var(--bg-card);
  border-radius: 8px;
  box-shadow: var(--shadow-card);
  margin-bottom: 6px;
}

.stats-title {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-tertiary);
  margin-bottom: 8px;
}

.stats-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
}

.stats-item {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 4px;
}

.stats-label {
  font-size: 11px;
  color: var(--text-secondary);
}

.stats-value {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
}
</style>
