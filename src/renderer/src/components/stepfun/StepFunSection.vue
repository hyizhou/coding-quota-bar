<!--
  StepFun（阶跃星辰）额度区块：额度卡片（速率窗口型/积分型双形态自适应）
  + 加油包卡（TYPE_TOPUP 桶）+ 账户余额 + 按小时×模型的积分用量图表（24h/7/30 天，24h 由 7 天小时粒度数据筛选，30 天按需加载）。
  订阅信息由 MainView 顶部的套餐徽章 + 悬停浮窗统一展示。
-->
<template>
  <div>
    <!-- 账户余额 -->
    <BalanceCard
      v-if="account.balance"
      :label="t('quota.stepfunBalance')"
      :value="currencySymbol + account.balance.total"
      :items="balanceItems"
    />

    <!-- 额度卡片：速率窗口型=5h+周两张，积分型=一张 -->
    <div v-for="(quota, idx) in account.quotas" :key="idx" class="quota-row">
      <QuotaCard
        :label="quota.label"
        :label-params="quota.labelParams"
        :usage-rate="quota.usageRate"
        :reset-at="quota.resetAt"
        :reset-text="formatResetFull(quota.resetAt)"
        :info-text="quota.limitType === 'stepfun-credits' ? creditAmountsText : ''"
        :color="quota.color"
      />
    </div>

    <!-- 加油包（仅 TYPE_TOPUP 桶）：标题带总量、右侧已用%、左下角已用/未用额度 -->
    <div v-for="(bucket, idx) in topupBuckets" :key="'topup-' + idx" class="topup-card">
      <div class="topup-header">
        <span class="topup-name">{{ t('quota.stepfunTopupPack') }} · {{ formatCreditsShort(bucket.total) }}</span>
        <span class="topup-percent" :class="{ red: usedPercent(bucket) >= 90 }">{{ usedPercent(bucket) }}%</span>
      </div>
      <div class="progress-bar">
        <div
          class="progress-fill"
          :class="usedPercent(bucket) >= 90 ? 'red' : 'green'"
          :style="{ width: usedPercent(bucket) + '%' }"
        ></div>
      </div>
      <div class="topup-footer">
        <span>{{ t('quota.stepfunTopupAmounts', { used: formatCreditsShort(bucket.total - bucket.residual), left: formatCreditsShort(bucket.residual) }) }}</span>
        <span v-if="bucket.expireAt">{{ formatResetFull(bucket.expireAt) }}</span>
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
import BalanceCard from '../BalanceCard.vue'
import QuotaCard from '../QuotaCard.vue'
import type { BalanceCardItem } from '../BalanceCard.vue'
import type { AccountUsageData, ModelTokenRecord } from '../../types'

// chart.js 体积大，按需加载：用户打开图表时才下载
const TokenChart = defineAsyncComponent(() => import('../TokenChart.vue'))

const { t, locale } = useI18n()

const props = defineProps<{
  account: AccountUsageData
}>()

const topupBuckets = computed(() => props.account.stepfunTopupBuckets ?? [])

/** Credit 总卡左下角具体用量（来自订阅桶绝对量；订阅桶缺失时返回空串，卡片不显示数值） */
const creditAmountsText = computed(() => {
  const amounts = props.account.stepfunCreditAmounts
  if (!amounts) return ''
  return t('quota.stepfunCreditAmounts', {
    used: formatCreditsShort(amounts.total - amounts.residual),
    left: formatCreditsShort(amounts.residual),
  })
})

const currencySymbol = computed(() => {
  const c = props.account.balance?.currency ?? props.account.currency
  return c === 'CNY' ? '¥' : '$'
})

/** 余额明细行：赠款/现金仅在有余额时展示 */
const balanceItems = computed<BalanceCardItem[]>(() => {
  const b = props.account.balance
  if (!b) return []
  const items: BalanceCardItem[] = []
  if (parseFloat(b.gift) > 0) items.push({ label: t('quota.stepfunGiftBalance'), value: `${currencySymbol.value}${b.gift}` })
  if (parseFloat(b.cash) > 0) items.push({ label: t('quota.stepfunCashBalance'), value: `${currencySymbol.value}${b.cash}` })
  return items
})

/** 时间完整文案：月日 + 时:分（额度重置/加油包到期共用，对齐官方粒度） */
function formatResetFull(iso: string): string {
  if (!iso) return ''
  try {
    const d = new Date(iso)
    if (isNaN(d.getTime())) return ''
    return d.toLocaleString(locale.value, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
  } catch {
    return ''
  }
}

/** Credits 数值自动单位缩写（B/M/K，保留至多 2 位小数） */
function formatCreditsShort(total: number): string {
  if (total >= 1_000_000_000) return `${(total / 1_000_000_000).toLocaleString(locale.value, { maximumFractionDigits: 2 })}B`
  if (total >= 1_000_000) return `${(total / 1_000_000).toLocaleString(locale.value, { maximumFractionDigits: 2 })}M`
  if (total >= 1_000) return `${(total / 1_000).toLocaleString(locale.value, { maximumFractionDigits: 2 })}K`
  return `${total}`
}

/** 加油包已用%（官方：Math.round((1 - rate) × 100)，驱动进度条与配色） */
function usedPercent(bucket: { total: number; residual: number }): number {
  if (bucket.total <= 0) return 0
  return Math.round((1 - bucket.residual / bucket.total) * 100)
}



// ===== 用量图表（7d 小时粒度数据随刷新下发，24h 由其筛选；30d 按需经 IPC 拉取，跨账户重置） =====

type TabValue = '24h' | '7d' | '30d'
const STORAGE_KEY_TAB = 'stepfun-usage-tab'

function restoreTab(): TabValue {
  try {
    const saved = localStorage.getItem(STORAGE_KEY_TAB)
    if (saved === '24h' || saved === '7d' || saved === '30d') return saved
  } catch {}
  return '7d'
}

const activeTab = ref<TabValue>(restoreTab())
const records7d = computed(() => props.account.modelHistory7d ?? [])
const records30d = ref<ModelTokenRecord[]>([])
const loaded30d = ref(false)
const loading30d = ref(false)

const tabs = computed(() => [
  { label: t('main.tab24h'), value: '24h' as TabValue },
  { label: t('main.tab7d'), value: '7d' as TabValue },
  { label: t('main.tab30d'), value: '30d' as TabValue },
])

/** 本地小时键 'YYYY-MM-DDTHH'（与 Provider 下发的小时粒度记录键一致） */
function localHourKey(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}`
}

/** 24h 视图：从 7 天小时粒度数据中取最近 24 个小时桶（含当前小时），无需额外请求 */
const records24h = computed(() => {
  const cutoff = localHourKey(new Date(Date.now() - 23 * 3600000))
  return records7d.value.filter(r => r.date.length === 13 && r.date >= cutoff)
})

const activeRecords = computed(() => {
  if (activeTab.value === '24h') return records24h.value
  return activeTab.value === '7d' ? records7d.value : records30d.value
})

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
.quota-row {
  margin-bottom: 6px;
}

/* 加油包卡（对齐官方两档配色：已用 ≥90% 红，否则绿） */
.topup-card {
  padding: 8px 10px;
  background: var(--bg-card);
  border-radius: 8px;
  box-shadow: var(--shadow-card);
  transition: background 0.2s, box-shadow 0.2s;
  margin-bottom: 6px;
}

.topup-card:hover {
  background: var(--bg-card-hover);
  box-shadow: var(--shadow-card-hover);
}

.topup-header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 5px;
}

.topup-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-heading);
}

.topup-percent {
  font-size: 16px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--text-primary);
}

.topup-percent.red { color: #dc2626; }

.progress-bar {
  height: 6px;
  background: var(--border-subtle);
  border-radius: 3px;
  overflow: hidden;
  margin-bottom: 5px;
}

.progress-fill {
  height: 100%;
  border-radius: 3px;
  transition: width 0.5s cubic-bezier(0.4, 0, 0.2, 1);
}
.progress-fill.green { background: linear-gradient(90deg, #4ade80, #22c55e); }
.progress-fill.red { background: linear-gradient(90deg, #f87171, #ef4444); }

.topup-footer {
  display: flex;
  justify-content: space-between;
  font-size: 10px;
  color: var(--text-tertiary);
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
