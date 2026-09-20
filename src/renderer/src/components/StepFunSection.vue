<!--
  StepFun（阶跃星辰）额度区块：额度卡片（速率窗口/积分双形态自适应）+ 积分桶明细
  + 订阅信息 + 账户余额 + 按小时×模型的积分用量图表（7/30 天，30 天按需加载）。
-->
<template>
  <div>
    <!-- 账户余额 -->
    <div class="balance-card card" v-if="account.balance">
      <div class="balance-header">
        <span class="balance-label">{{ t('quota.stepfunBalance') }}</span>
        <span class="balance-value">{{ currencySymbol }}{{ account.balance.total }}</span>
      </div>
      <div class="balance-detail" v-if="hasBalanceDetail">
        <span v-if="parseFloat(account.balance.gift) > 0" class="balance-item">
          {{ t('quota.stepfunGiftBalance') }} {{ currencySymbol }}{{ account.balance.gift }}
        </span>
        <span v-if="parseFloat(account.balance.cash) > 0" class="balance-item">
          {{ t('quota.stepfunCashBalance') }} {{ currencySymbol }}{{ account.balance.cash }}
        </span>
      </div>
    </div>

    <!-- 额度卡片：速率窗口型=5h+周两张，积分型=一张 -->
    <div v-for="(quota, idx) in account.quotas" :key="idx" class="quota-row">
      <QuotaCard
        :label="quota.label"
        :label-params="quota.labelParams"
        :usage-rate="quota.usageRate"
        :reset-at="quota.resetAt"
        :color="quota.color"
      />
    </div>

    <!-- 积分桶明细（仅积分型套餐返回） -->
    <div v-if="buckets.length" class="buckets-card card">
      <div class="buckets-title">{{ t('quota.stepfunCreditBuckets') }}</div>
      <div v-for="(bucket, idx) in buckets" :key="idx" class="bucket-row">
        <span class="bucket-name">{{ t('quota.stepfunBucketType', { n: idx + 1 }) }}</span>
        <span class="bucket-value">{{ formatCount(bucket.residual) }} / {{ formatCount(bucket.total) }}</span>
        <span v-if="bucket.expireAt" class="bucket-expire">
          {{ t('quota.stepfunBucketExpire', { date: formatDate(bucket.expireAt) }) }}
        </span>
      </div>
    </div>

    <!-- 订阅信息 -->
    <div v-if="account.subscription" class="subscription-card card">
      <div class="sub-row">
        <span class="sub-label">{{ t('subscription.plan') }}</span>
        <span class="sub-value">{{ account.subscription.plan || '-' }}</span>
      </div>
      <div class="sub-row" v-if="account.subscription.nextRenewTime">
        <span class="sub-label">{{ t('subscription.nextRenew') }}</span>
        <span class="sub-value">{{ formatDate(account.subscription.nextRenewTime) }}</span>
      </div>
      <div class="sub-row">
        <span class="sub-label">{{ t('subscription.autoRenew') }}</span>
        <span class="sub-value">{{ account.subscription.autoRenew ? t('subscription.yes') : t('subscription.no') }}</span>
      </div>
      <div class="sub-row" v-if="account.subscription.actualPrice">
        <span class="sub-label">{{ t('subscription.actualPrice') }}</span>
        <span class="sub-value">{{ currencySymbol }}{{ account.subscription.actualPrice }}</span>
      </div>
    </div>

    <!-- 用量图表：按小时×模型的积分消耗 -->
    <div class="usage-stats">
      <div class="stats-tabs-row">
        <span class="chart-title">{{ t('quota.stepfunCreditsUsage') }}</span>
        <div class="stats-time-tabs">
          <button
            v-for="tab in tabs"
            :key="tab.value"
            class="tab-btn"
            :class="{ active: activeTab === tab.value }"
            @click="onTabChange(tab.value)"
          >{{ tab.label }}</button>
        </div>
      </div>
      <div v-if="loading30d" class="chart-loading">...</div>
      <template v-else>
        <TokenChart
          v-if="activeRecords.length"
          :title="t('quota.stepfunCreditsUsage')"
          :model-records-1d="activeRecords"
          :model-records-7d="records7d"
          :model-records-30d="records30d"
          :active-tab="activeTab"
        />
        <div v-else class="no-data">{{ t('main.noUsageData') }}</div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, defineAsyncComponent } from 'vue'
import { useI18n } from 'vue-i18n'
import QuotaCard from './QuotaCard.vue'
import type { AccountUsageData, ModelTokenRecord } from '../types'

// chart.js 体积大，按需加载：用户打开图表时才下载
const TokenChart = defineAsyncComponent(() => import('./TokenChart.vue'))

const { t, locale } = useI18n()

const props = defineProps<{
  account: AccountUsageData
}>()

const buckets = computed(() => props.account.stepfunCreditBuckets ?? [])

const currencySymbol = computed(() => {
  const c = props.account.balance?.currency ?? props.account.currency
  return c === 'CNY' ? '¥' : '$'
})

const hasBalanceDetail = computed(() => {
  const b = props.account.balance
  if (!b) return false
  return parseFloat(b.gift) > 0 || parseFloat(b.cash) > 0
})

function formatCount(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(2)}K`
  return `${n}`
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso)
    if (isNaN(d.getTime())) return iso
    return d.toLocaleDateString(locale.value, { year: 'numeric', month: 'short', day: 'numeric' })
  } catch {
    return iso
  }
}

// ===== 用量图表（7d 数据随刷新下发；30d 按需经 IPC 拉取，跨账户重置） =====

type TabValue = '7d' | '30d'
const STORAGE_KEY_TAB = 'stepfun-usage-tab'

function restoreTab(): TabValue {
  try {
    const saved = localStorage.getItem(STORAGE_KEY_TAB)
    if (saved === '7d' || saved === '30d') return saved
  } catch {}
  return '7d'
}

const activeTab = ref<TabValue>(restoreTab())
const records7d = computed(() => props.account.modelHistory7d ?? [])
const records30d = ref<ModelTokenRecord[]>([])
const loaded30d = ref(false)
const loading30d = ref(false)

const tabs = computed(() => [
  { label: t('main.tab7d'), value: '7d' as TabValue },
  { label: t('main.tab30d'), value: '30d' as TabValue },
])

const activeRecords = computed(() => activeTab.value === '7d' ? records7d.value : records30d.value)

async function load30d(): Promise<void> {
  if (loaded30d.value || loading30d.value) return
  loading30d.value = true
  try {
    records30d.value = await window.electronAPI.stepfunFetchUsageHistory(props.account.id, 30)
    loaded30d.value = true
  } catch {
    records30d.value = []
  } finally {
    loading30d.value = false
  }
}

function onTabChange(tab: TabValue): void {
  activeTab.value = tab
  try { localStorage.setItem(STORAGE_KEY_TAB, tab) } catch {}
  if (tab === '30d') load30d()
}

// 账户切换（多账户 tabs）时清空 30 天缓存，避免串账户数据
watch(() => props.account.id, () => {
  records30d.value = []
  loaded30d.value = false
})

onMounted(() => {
  if (activeTab.value === '30d') load30d()
})
</script>

<style scoped>
.balance-card,
.buckets-card,
.subscription-card {
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

.quota-row {
  margin-bottom: 6px;
}

.buckets-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-heading);
  margin-bottom: 4px;
}

.bucket-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 8px;
  padding: 2px 0;
}

.bucket-name {
  font-size: 11px;
  color: var(--text-secondary);
}

.bucket-value {
  font-size: 11px;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
}

.bucket-expire {
  font-size: 10px;
  color: var(--text-tertiary);
  font-variant-numeric: tabular-nums;
}

.sub-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  padding: 2px 0;
}

.sub-label {
  font-size: 11px;
  color: var(--text-secondary);
}

.sub-value {
  font-size: 11px;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
}

.usage-stats {
  margin-top: 8px;
}

.stats-tabs-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
}

.chart-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-heading);
}

.stats-time-tabs {
  display: flex;
  gap: 2px;
}

.tab-btn {
  background: none;
  border: 1px solid var(--border-tab);
  border-radius: 4px;
  padding: 1px 6px;
  font-size: 10px;
  color: var(--text-tertiary);
  cursor: pointer;
  transition: all 0.15s;
  line-height: 1.4;
}

.tab-btn:hover { color: var(--text-secondary); border-color: var(--border-tab-hover); }
.tab-btn.active {
  background: var(--bg-toggle-active);
  color: var(--bg-input);
  border-color: var(--bg-toggle-active);
}

.no-data {
  text-align: center;
  color: var(--text-tertiary);
  font-size: 12px;
  padding: 20px 0;
}

.chart-loading {
  text-align: center;
  color: var(--text-tertiary);
  font-size: 12px;
  padding: 20px 0;
}
</style>
