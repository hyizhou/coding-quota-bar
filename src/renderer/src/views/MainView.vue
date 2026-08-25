<template>
  <div class="view-main">
    <header class="header">
      <h1>{{ $t('main.title') }}</h1>
      <div class="header-actions">
        <button
          class="icon-btn pin-btn"
          :class="{ active: pinMode !== 'unpinned', desktop: pinMode === 'pinned-desktop' }"
          :title="$t('main.pinWindow')"
          @click="togglePin"
        >
          <svg v-if="pinMode === 'unpinned'" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.89A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.89A2 2 0 0 0 5 15.24Z"/>
          </svg>
          <svg v-else-if="pinMode === 'pinned-top'" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round">
            <line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.89A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.89A2 2 0 0 0 5 15.24Z"/>
          </svg>
          <svg v-else width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round">
            <line x1="12" y1="17" x2="12" y2="20"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.89A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.89A2 2 0 0 0 5 15.24Z"/><line x1="6" y1="21" x2="18" y2="21" stroke-width="2"/>
          </svg>
        </button>
        <button class="icon-btn" :title="$t('main.toggleTheme')" @click="toggleTheme">
          <svg v-if="isDark" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
          </svg>
          <svg v-else width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
          </svg>
        </button>
        <button class="icon-btn" :title="$t('main.settingsBtn')" @click="$emit('open-settings')">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
          </svg>
        </button>
        <button class="icon-btn" :title="$t('main.refreshBtn')" :disabled="loading" :class="{ spinning: loading }" @click="handleRefresh">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
          </svg>
        </button>
      </div>
      <div
        v-if="providers.length > 1"
        class="provider-arrow"
        :class="{ 'arrow-hidden': showTabs }"
        @mouseenter="onTabsAreaEnter"
        @mouseleave="onTabsAreaLeave"
      >
        <svg width="10" height="6" viewBox="0 0 10 6">
          <path d="M1 1l4 4 4-4" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"/>
        </svg>
      </div>
      <div
        v-if="providers.length > 1"
        class="provider-arrow-hit"
        :class="{ 'arrow-hidden': showTabs }"
        @mouseenter="onTabsAreaEnter"
        @mouseleave="onTabsAreaLeave"
      ></div>
    </header>
    <div v-if="providers.length > 1" class="provider-tabs" :class="{ expanded: showTabs }" @mouseenter="onTabsAreaEnter" @mouseleave="onTabsAreaLeave" @wheel.passive="onTabsWheel">
      <button
        class="provider-tab"
        :class="{ active: showOverview }"
        @click="setActiveProvider(OVERVIEW_KEY)"
      >
        {{ $t('main.overview') }}
      </button>
      <button
        v-for="p in providers"
        :key="p.key"
        class="provider-tab"
        :class="{ active: activeProviderKey === p.key }"
        @click="setActiveProvider(p.key)"
      >
        {{ p.name }}
      </button>
    </div>

    <div class="main-body">
      <template v-if="initialLoading">
        <div class="skeleton-group">
          <div class="skeleton skeleton-title"></div>
          <div class="skeleton skeleton-card"></div>
          <div class="skeleton skeleton-card"></div>
        </div>
      </template>
      <template v-else-if="providers.length === 0">
        <div class="empty-state">
          <p>{{ $t('main.emptyState') }}</p>
          <p class="hint">{{ $t('main.emptyHint') }}</p>
        </div>
      </template>

      <template v-else>
        <template v-if="showOverview">
          <ProviderOverview :providers="providers" :active-accounts="activeAccounts" @select-provider="setActiveProvider" />
        </template>
        <template v-else-if="activeProvider">
        <div class="provider-section">
          <div class="provider-name-row">
            <span class="provider-name" :class="{ clickable: !!activeProvider.websiteUrl }" @click="openProviderWebsite(activeProvider.websiteUrl)">{{ activeProvider.name }}</span>
            <!-- 账户切换按钮：仅当 2 个及以上账户时显示 -->
            <div v-if="activeProvider.accounts.length > 1" class="account-tabs" @wheel.passive="onTabsWheel">
              <button
                v-for="(acc, idx) in activeProvider.accounts"
                :key="acc.id"
                class="account-tab"
                :class="{ active: getActiveAccountId(activeProvider) === acc.id }"
                @click="setActiveAccount(activeProvider, acc.id)"
              >
                {{ acc.label || $t('main.defaultAccountLabel', { n: idx + 1 }) }}
              </button>
            </div>
            <div class="provider-name-actions">
              <span v-if="isPlanExpired(activeProvider)" class="provider-level-expired">{{ $t('main.expired') }}</span>
              <FloatingTooltip v-if="getActiveAccount(activeProvider)?.level" position="bottom" align="right" :rows="getSubRows(getActiveAccount(activeProvider)!.subscription)">
                <span class="provider-level">{{ getActiveAccount(activeProvider)!.level }}</span>
              </FloatingTooltip>
              <button
                v-if="activeProvider.key === 'zhipu'"
                class="icon-btn concurrency-btn"
                :title="$t('concurrencyTest.tooltip')"
                @click="$emit('open-concurrency-test')"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
                </svg>
              </button>
            </div>
          </div>

          <template v-if="getActiveAccount(activeProvider)">
            <div v-if="getActiveAccount(activeProvider)!.error" class="error-card">
              <span class="error-icon">!</span>
              <span class="error-text">
                <template v-if="getActiveAccount(activeProvider)!.error === 'TOKEN_EXPIRED'">
                  <template v-if="activeProvider.key === 'codex'">{{ $t('main.codexTokenExpired') }}</template>
                  <template v-else>
                    {{ activeProvider.key === 'mimo' ? $t('main.mimoTokenExpired') : activeProvider.key === 'opencode-go' ? $t('main.opencodegoTokenExpired') : $t('main.deepseekTokenExpired') }}
                    <button class="relogin-btn" @click="$emit('open-settings')">{{ $t('main.reloginBtn') }}</button>
                  </template>
                </template>
                <template v-else>{{ formatError(getActiveAccount(activeProvider)!.error!) }}</template>
              </span>
            </div>
            <template v-else>
              <ZhipuSection v-if="activeProvider.key === 'zhipu'" :account="getActiveAccount(activeProvider)!" />
              <MiniMaxSection v-else-if="activeProvider.key === 'minimax'" :account="getActiveAccount(activeProvider)!" />
              <DeepSeekSection v-else-if="activeProvider.key === 'deepseek'" :account="getActiveAccount(activeProvider)!" @open-settings="$emit('open-settings')" />
              <MiMoSection v-else-if="activeProvider.key === 'mimo'" :account="getActiveAccount(activeProvider)!" />
              <CodexSection v-else-if="activeProvider.key === 'codex'" :account="getActiveAccount(activeProvider)!" />
              <OpenCodeGoSection v-else-if="activeProvider.key === 'opencode-go'" :account="getActiveAccount(activeProvider)!" />
              <DeepSeekServiceStatus v-if="activeProvider.key === 'deepseek' && !getActiveAccount(activeProvider)!.error" :account="getActiveAccount(activeProvider)!" />
            </template>
          </template>
        </div>
      </template>
      </template>
    </div>

    <UpdateBanner
      v-if="updateNotification"
      :version="updateNotification.version"
      @click="handleUpdateBannerClick"
      @close="updateNotification = null"
    />

    <footer class="footer">
      <span class="footer-status">
        <span
          class="status-dot"
          :class="freshnessClass"
          :title="freshnessTitle"
          role="status"
          :aria-label="freshnessTitle"
        ></span>
        <span>{{ lastUpdateText }}</span>
      </span>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import FloatingTooltip from '../components/FloatingTooltip.vue'
import UpdateBanner from '../components/UpdateBanner.vue'
import ProviderOverview from '../components/ProviderOverview.vue'
import ZhipuSection from '../components/ZhipuSection.vue'
import MiniMaxSection from '../components/MiniMaxSection.vue'
import DeepSeekSection from '../components/DeepSeekSection.vue'
import DeepSeekServiceStatus from '../components/DeepSeekServiceStatus.vue'
import MiMoSection from '../components/MiMoSection.vue'
import OpenCodeGoSection from '../components/OpenCodeGoSection.vue'
import CodexSection from '../components/CodexSection.vue'
import type { ProviderUsageData, AccountUsageData, UsageState, WindowPinMode } from '../types'
import { useTheme } from '../composables/useTheme'

const emit = defineEmits<{ 'open-settings': [options?: { checkUpdate?: boolean }]; 'open-concurrency-test': [] }>()

const { t, locale } = useI18n()
const { isDark, toggleTheme } = useTheme()

const providers = ref<ProviderUsageData[]>([])
const lastUpdate = ref('')
const loading = ref(false)
const initialLoading = ref(true)
const updateNotification = ref<{ version: string } | null>(null)
const now = ref(Date.now())
const pinMode = ref<WindowPinMode>('unpinned')
const showTabs = ref(false)
let hideTimer: ReturnType<typeof setTimeout> | null = null
let offUpdateStatus: (() => void) | null = null

function onTabsAreaEnter() {
  if (hideTimer) { clearTimeout(hideTimer); hideTimer = null }
  showTabs.value = true
}

function onTabsAreaLeave() {
  hideTimer = setTimeout(() => { showTabs.value = false }, 150)
}

// Provider Tab 状态
const OVERVIEW_KEY = '__overview'
const STORAGE_KEY_ACCOUNTS = 'active-accounts'
const STORAGE_KEY_PROVIDER = 'active-provider'
const activeAccounts = ref<Record<string, string>>({})
const activeProviderKey = ref('')

function saveActiveAccounts() {
  try { localStorage.setItem(STORAGE_KEY_ACCOUNTS, JSON.stringify(activeAccounts.value)) } catch {}
}

function restoreActiveAccounts() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY_ACCOUNTS)
    if (saved) activeAccounts.value = JSON.parse(saved)
  } catch {}
}

function restoreActiveProvider() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY_PROVIDER)
    if (saved) activeProviderKey.value = saved
  } catch {}
}

function setActiveProvider(key: string) {
  activeProviderKey.value = key
  try { localStorage.setItem(STORAGE_KEY_PROVIDER, key) } catch {}
}

const activeProvider = computed(() => {
  if (showOverview.value) return undefined
  if (providers.value.length === 0) return undefined
  if (providers.value.length === 1) return providers.value[0]
  const key = activeProviderKey.value || providers.value[0]?.key
  return providers.value.find(p => p.key === key) || providers.value[0]
})

const showOverview = computed(() =>
  providers.value.length > 1 && (!activeProviderKey.value || activeProviderKey.value === OVERVIEW_KEY)
)

function getActiveAccountId(p: ProviderUsageData): string {
  return activeAccounts.value[p.key] || (p.accounts[0]?.id ?? '')
}

function getActiveAccount(p: ProviderUsageData): AccountUsageData | undefined {
  const id = getActiveAccountId(p)
  return p.accounts.find(a => a.id === id) || p.accounts[0]
}

function isPlanExpired(p: ProviderUsageData): boolean {
  return getActiveAccount(p)?.subscription?.status === 'EXPIRED'
}

function setActiveAccount(p: ProviderUsageData, accountId: string): void {
  activeAccounts.value[p.key] = accountId
  saveActiveAccounts()
}

const lastUpdateText = computed(() => {
  if (!lastUpdate.value) return t('main.lastUpdateFallback')
  try {
    const date = new Date(lastUpdate.value)
    const diffMins = Math.floor((now.value - date.getTime()) / 60000)
    if (diffMins < 1) return t('main.justNow')
    if (diffMins < 60) return t('main.minutesAgo', { n: diffMins })
    if (diffMins < 1440) return t('main.hoursAgo', { n: Math.floor(diffMins / 60) })
    return date.toLocaleTimeString(locale.value, { hour: '2-digit', minute: '2-digit' })
  } catch { return lastUpdate.value }
})

/**
 * 数据新鲜度：< 1min 绿、1-5min 黄、> 5min 红、无数据灰
 * 用点色 + 脉冲动画暗示"是否需要刷新"
 */
const freshnessClass = computed(() => {
  if (!lastUpdate.value) return 'status-unknown'
  const diffMins = Math.floor((now.value - new Date(lastUpdate.value).getTime()) / 60000)
  if (diffMins < 1) return 'status-fresh'
  if (diffMins < 5) return 'status-warm'
  return 'status-stale'
})

const freshnessTitle = computed(() => {
  const c = freshnessClass.value
  if (c === 'status-fresh') return '数据最新'
  if (c === 'status-warm') return '数据略旧，点击刷新'
  if (c === 'status-stale') return '数据过期，建议刷新'
  return '尚未获取数据'
})

function applyState(state: UsageState) {
  providers.value = state.providers
  lastUpdate.value = state.lastUpdate
  initialLoading.value = false
  restoreActiveAccounts()
  restoreActiveProvider()
}

async function fetchData() {
  try {
    const state = await window.electronAPI.getUsageData()
    if (state) applyState(state)
  } catch (e) { console.error('[MainView] fetch failed:', e) }
}

async function handleRefresh() {
  loading.value = true
  try {
    const state = await window.electronAPI.refreshUsage()
    if (state) applyState(state)
  } catch (e) { console.error('[MainView] refresh failed:', e) }
  finally { loading.value = false }
}

function formatError(msg: string): string {
  // 去掉 [Zhipu] 等前缀，保留核心信息
  return msg.replace(/^\[[\w]+\]\s*/, '')
}

function openProviderWebsite(url?: string) {
  if (url) window.electronAPI.openExternal(url)
}

function togglePin() {
  const next: WindowPinMode =
    pinMode.value === 'unpinned' ? 'pinned-top'
    : pinMode.value === 'pinned-top' ? 'pinned-desktop'
    : 'unpinned'
  pinMode.value = next
  window.electronAPI.setWindowPinned(next)
}

function getSubRows(sub: AccountUsageData['subscription']) {
  if (!sub) return []
  const rows: { label: string; value: string }[] = [
    { label: t('subscription.plan'), value: sub.plan },
  ]
  if (sub.currentRenewTime) rows.push({ label: t('subscription.subDate'), value: sub.currentRenewTime })
  if (sub.nextRenewTime) rows.push({ label: t('subscription.nextRenew'), value: sub.nextRenewTime })
  rows.push({ label: t('subscription.autoRenew'), value: sub.autoRenew ? t('subscription.yes') : t('subscription.no') })
  if (sub.actualPrice) rows.push({ label: t('subscription.actualPrice'), value: String(sub.actualPrice) })
  if (sub.renewPrice) rows.push({ label: t('subscription.renewPrice'), value: String(sub.renewPrice) })
  return rows
}

function onTabsWheel(e: WheelEvent) {
  const el = e.currentTarget as HTMLElement
  el.scrollLeft += e.deltaY
}

function handleUpdateBannerClick() {
  updateNotification.value = null
  emit('open-settings', { checkUpdate: true })
}

// 1 分钟刷一次 "x 分钟前" 显示；用 handle 保存以便卸载清理
// 否则每次弹窗开关都泄漏一个 timer
let nowTimer: ReturnType<typeof setInterval> | null = null

onMounted(async () => {
  // 启动 now 刷新 timer（与其他副作用合并到同一个 onMounted）
  if (nowTimer === null) {
    nowTimer = setInterval(() => { now.value = Date.now() }, 60000)
  }
  fetchData()
  // 监听主进程推送的数据更新
  window.electronAPI.onUsageDataUpdated((data) => {
    if (data) applyState(data)
  })
  // 监听窗口固定状态
  window.electronAPI.onWindowPinnedState((mode) => {
    pinMode.value = mode
  })
  // 监听主进程推送的更新状态
  offUpdateStatus = window.electronAPI.onUpdateStatusChanged((status) => {
    if (status.phase === 'available' || status.phase === 'downloading') {
      updateNotification.value = { version: status.version || '' }
    } else {
      updateNotification.value = null
    }
  })
  // 恢复持久化的更新状态
  const config = await window.electronAPI.getConfig()
  const version = await window.electronAPI.getAppVersion()
  const us = config?.updateStatus
  if (us && us.version && us.version > version && us.phase !== 'ready') {
    updateNotification.value = { version: us.version }
  }
})

onUnmounted(() => {
  // 清理 now timer（与其他卸载清理合并）
  if (nowTimer !== null) {
    clearInterval(nowTimer)
    nowTimer = null
  }
  offUpdateStatus?.()
})
</script>

<style scoped>
.view-main {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.header {
  position: relative;
}

.provider-arrow {
  position: absolute;
  bottom: -14px;
  left: 50%;
  transform: translateX(-50%);
  -webkit-app-region: no-drag;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 14px;
  cursor: pointer;
  color: var(--text-tertiary);
  opacity: 0.4;
  transition: opacity 0.2s, color 0.2s;
  z-index: 20;
}

.provider-arrow:hover {
  opacity: 1;
  color: var(--text-secondary);
}

.provider-arrow.arrow-hidden {
  opacity: 0 !important;
  pointer-events: none;
}

.provider-arrow-hit {
  position: absolute;
  bottom: -14px;
  left: 50%;
  transform: translateX(-50%);
  width: 180px;
  height: 14px;
  z-index: 19;
}

.provider-arrow-hit.arrow-hidden {
  pointer-events: none;
}

.main-body {
  flex: 1;
  overflow-y: auto;
  padding: 0 10px;
}

.main-body::-webkit-scrollbar { width: 3px; }
.main-body::-webkit-scrollbar-thumb { background: transparent; border-radius: 2px; }
.main-body:hover::-webkit-scrollbar-thumb { background: var(--scrollbar-thumb); }

.provider-section {
  margin-bottom: 10px;
}

.provider-tabs {
  display: flex;
  justify-content: center;
  gap: 2px;
  background: var(--bg-tab-bar);
  border-radius: 8px;
  max-height: 0;
  overflow: hidden;
  overflow-x: hidden;
  opacity: 0;
  margin: 0 10px;
  padding: 0 2px;
  transition: max-height 0.25s cubic-bezier(0.4, 0, 0.2, 1),
              opacity 0.2s ease,
              margin 0.25s cubic-bezier(0.4, 0, 0.2, 1),
              padding 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}

.provider-tabs.expanded {
  max-height: 40px;
  overflow-x: auto;
  opacity: 1;
  margin-bottom: 8px;
  padding: 2px;
  scrollbar-width: none;
  -ms-overflow-style: none;
  scrollbar-gutter: stable;
}
.provider-tabs.expanded::-webkit-scrollbar {
  display: none;
}

.provider-tab {
  font-size: 12px;
  padding: 3px 10px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.2s, color 0.2s, box-shadow 0.2s;
  flex-shrink: 0;
}
.provider-tab:hover {
  color: var(--text-secondary);
}
.provider-tab.active {
  color: var(--text-heading);
  font-weight: 600;
  background: var(--bg-tab-active);
  box-shadow: var(--shadow-tab-active);
}

.provider-tabs::-webkit-scrollbar {
  display: none;
}
.provider-tabs {
  scrollbar-width: none;
}

.provider-name-row {
  display: flex;
  align-items: baseline;
  gap: 6px;
  margin-bottom: 6px;
}

.provider-name {
  font-size: 14px;
  font-weight: 700;
  color: var(--text-heading);
  white-space: nowrap;
}
.provider-name.clickable {
  cursor: pointer;
  transition: opacity 0.15s;
}
.provider-name.clickable:hover {
  opacity: 0.8;
}

.account-tabs {
  display: flex;
  gap: 4px;
  flex: 1;
  min-width: 0;
  overflow-x: auto;
  scrollbar-width: none;
  /* 修：左右留 padding 让 tab border 不贴边（之前 border 直接贴容器边缘
     看起来像滚动条边框） */
  padding: 0 4px;
  /* 修：底部留 3px 给滚动条专属空间，避免覆盖下面 QuotaCard 文字 */
  padding-bottom: 3px;
  /* 修：IE/旧 Edge 隐藏滚动条 */
  -ms-overflow-style: none;
  /* 修：scrollbar-gutter stable 即使没滚动条也预留位置，避免布局抖动 */
  scrollbar-gutter: stable;
}
.account-tabs::-webkit-scrollbar {
  display: none;
}

.account-tab {
  font-size: 11px;
  padding: 1px 6px;
  border: 1px solid var(--border-subtle);
  border-radius: 6px;
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
  transition: all 0.15s;
  white-space: nowrap;
  line-height: 1;
  /* 修：账号多时不被压缩（之前 flex-shrink: 1 会让按钮变窄、文字截断） */
  flex-shrink: 0;
}
.account-tab:hover {
  border-color: var(--border-default);
}
.account-tab.active {
  color: var(--text-heading);
  font-weight: 600;
  border-color: var(--border-default);
}

.provider-name-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-left: auto;
  flex-shrink: 0;
}

.provider-level {
  font-size: 10px;
  font-weight: 600;
  color: #fff;
  background: #555;
  padding: 2px 6px;
  border-radius: 8px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  white-space: nowrap;
  line-height: 1;
  cursor: default;
}

.provider-level-expired {
  font-size: 10px;
  font-weight: 600;
  color: #fff;
  background: #dc2626;
  padding: 2px 6px;
  border-radius: 8px;
  letter-spacing: 0.5px;
  white-space: nowrap;
  line-height: 1;
  cursor: default;
}

.provider-name-row > .ft-wrapper {
  margin-left: auto;
  flex-shrink: 0;
  line-height: 1;
}

.concurrency-btn {
  padding: 2px !important;
  opacity: 0.5;
  color: var(--text-secondary);
}
.concurrency-btn:hover {
  opacity: 1;
  color: var(--color-info, #3B82F6);
}

.provider-section .quota-row-single .quota-card {
  margin-bottom: 6px;
}

.quota-row-pair {
  display: flex;
  gap: 6px;
  margin-bottom: 6px;
}

.quota-row-pair .quota-card {
  flex: 1;
  min-width: 0;
  padding: 6px 8px;
}

.quota-row-pair .quota-label {
  font-size: 11px;
}

.quota-row-pair .quota-percent {
  font-size: 14px;
}

.quota-row-pair .reset-text {
  font-size: 9px;
}

.empty-state {
  text-align: center;
  padding: 24px 12px;
  color: var(--text-empty);
}
.empty-state p { margin-bottom: 4px; }
.empty-state .hint { font-size: 11px; color: var(--text-empty-hint); }

.error-card {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  background: var(--bg-error);
  border: 1px solid var(--border-error);
  border-radius: 8px;
  margin-bottom: 6px;
}

.error-icon {
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--cqb-red);
  color: #fff;
  font-size: 12px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
}

.error-text {
  font-size: 12px;
  color: var(--text-error);
  line-height: 1.4;
}

.relogin-btn {
  font-size: 11px;
  padding: 2px 8px;
  margin-left: 6px;
  border: 1px solid #3B82F6;
  border-radius: 4px;
  background: transparent;
  color: #3B82F6;
  cursor: pointer;
}

.relogin-btn:hover {
  background: #3B82F6;
  color: #fff;
}

.skeleton-group {
  padding: 4px 0;
}

.skeleton {
  border-radius: 8px;
  background: linear-gradient(90deg, var(--skeleton-a) 25%, var(--skeleton-b) 50%, var(--skeleton-a) 75%);
  background-size: 200% 100%;
  animation: shimmer 1.5s ease-in-out infinite;
}

.skeleton-title {
  width: 60px;
  height: 16px;
  margin-bottom: 8px;
}

.skeleton-card {
  height: 68px;
  margin-bottom: 6px;
}

@keyframes shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

.spinning svg {
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

/* Pin button: hidden by default, visible on window hover */
.pin-btn {
  opacity: 0;
  transition: opacity 0.15s, background 0.15s, color 0.15s;
}

.header:hover .pin-btn {
  opacity: 1;
}

.pin-btn.active {
  opacity: 1;
  color: var(--text-primary);
}

/* === Footer 状态点 === */
.footer-status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  display: inline-block;
  position: relative;
  transition: background 0.3s;
}

/* 数据新鲜（< 1min）：纯绿，无动画 */
.status-dot.status-fresh {
  background: var(--cqb-green);
  box-shadow: 0 0 0 2px rgba(74, 222, 128, 0.18);
}

/* 数据略旧（1-5min）：黄色，慢脉冲暗示"该刷新了" */
.status-dot.status-warm {
  background: var(--cqb-yellow);
  box-shadow: 0 0 0 2px rgba(250, 204, 21, 0.20);
  animation: dot-pulse 2.4s ease-in-out infinite;
}

/* 数据过期（> 5min）：红色，快脉冲 + 视觉刺眼 */
.status-dot.status-stale {
  background: var(--cqb-red);
  box-shadow: 0 0 0 2px rgba(248, 113, 113, 0.22);
  animation: dot-pulse 1.4s ease-in-out infinite;
}

/* 尚未获取数据：灰色 */
.status-dot.status-unknown {
  background: var(--cqb-gray);
  opacity: 0.5;
}

@keyframes dot-pulse {
  0%, 100% { box-shadow: 0 0 0 0 currentColor; }
  50%      { box-shadow: 0 0 0 4px transparent; }
}

/* 固定且不置顶（桌面模式）：以次级文字色区分于置顶固定 */
.pin-btn.desktop {
  color: var(--text-secondary);
}
</style>
