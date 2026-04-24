<template>
  <div class="view-main">
    <header class="header">
      <h1>{{ $t('main.title') }}</h1>
      <div class="header-actions">
        <button
          class="icon-btn pin-btn"
          :class="{ active: isPinned }"
          :title="isPinned ? $t('main.unpinWindow') : $t('main.pinWindow')"
          @click="togglePin"
        >
          <svg v-if="!isPinned" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.89A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.89A2 2 0 0 0 5 15.24Z"/>
          </svg>
          <svg v-else width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round">
            <line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.89A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.89A2 2 0 0 0 5 15.24Z"/>
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
    </header>
    <div v-if="providers.length > 1" class="provider-tabs" :class="{ expanded: showTabs }" @mouseenter="onTabsAreaEnter" @mouseleave="onTabsAreaLeave" @wheel.passive="onTabsWheel">
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
        <template v-if="activeProvider">
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
            <FloatingTooltip v-if="getActiveAccount(activeProvider)?.level" position="bottom" align="right" :rows="getSubRows(getActiveAccount(activeProvider)!.subscription)">
              <span class="provider-level">{{ getActiveAccount(activeProvider)!.level }}</span>
            </FloatingTooltip>
          </div>

          <template v-if="getActiveAccount(activeProvider)">
            <div v-if="getActiveAccount(activeProvider)!.error" class="error-card">
              <span class="error-icon">!</span>
              <span class="error-text">{{ formatError(getActiveAccount(activeProvider)!.error!) }}</span>
            </div>
            <template v-else>
              <ZhipuSection v-if="activeProvider.key === 'zhipu'" :account="getActiveAccount(activeProvider)!" />
              <MiniMaxSection v-else-if="activeProvider.key === 'minimax'" :account="getActiveAccount(activeProvider)!" />
              <DeepSeekSection v-else-if="activeProvider.key === 'deepseek'" :account="getActiveAccount(activeProvider)!" />
              <DeepSeekServiceStatus v-if="activeProvider.key === 'deepseek' && !getActiveAccount(activeProvider)!.error" :account="getActiveAccount(activeProvider)!" />
            </template>
          </template>
        </div>
      </template>
      </template>
    </div>

    <footer class="footer">
      <span>{{ lastUpdateText }}</span>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import FloatingTooltip from '../components/FloatingTooltip.vue'
import ZhipuSection from '../components/ZhipuSection.vue'
import MiniMaxSection from '../components/MiniMaxSection.vue'
import DeepSeekSection from '../components/DeepSeekSection.vue'
import DeepSeekServiceStatus from '../components/DeepSeekServiceStatus.vue'
import type { ProviderUsageData, AccountUsageData, UsageState } from '../types'
import { useTheme } from '../composables/useTheme'

defineEmits<{ 'open-settings': [] }>()

const { t, locale } = useI18n()
const { isDark, toggleTheme } = useTheme()

const providers = ref<ProviderUsageData[]>([])
const lastUpdate = ref('')
const loading = ref(false)
const initialLoading = ref(true)
const now = ref(Date.now())
const isPinned = ref(false)
const showTabs = ref(false)
let hideTimer: ReturnType<typeof setTimeout> | null = null

function onTabsAreaEnter() {
  if (hideTimer) { clearTimeout(hideTimer); hideTimer = null }
  showTabs.value = true
}

function onTabsAreaLeave() {
  hideTimer = setTimeout(() => { showTabs.value = false }, 150)
}

// Provider Tab 状态
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
  if (providers.value.length === 0) return undefined
  if (providers.value.length === 1) return providers.value[0]
  const key = activeProviderKey.value || providers.value[0]?.key
  return providers.value.find(p => p.key === key) || providers.value[0]
})

function getActiveAccountId(p: ProviderUsageData): string {
  return activeAccounts.value[p.key] || (p.accounts[0]?.id ?? '')
}

function getActiveAccount(p: ProviderUsageData): AccountUsageData | undefined {
  const id = getActiveAccountId(p)
  return p.accounts.find(a => a.id === id) || p.accounts[0]
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
  isPinned.value = !isPinned.value
  window.electronAPI.setWindowPinned(isPinned.value)
}

function getSubRows(sub: AccountUsageData['subscription']) {
  if (!sub) return []
  return [
    { label: t('subscription.plan'), value: sub.plan },
    { label: t('subscription.subDate'), value: sub.currentRenewTime },
    { label: t('subscription.nextRenew'), value: sub.nextRenewTime },
    { label: t('subscription.autoRenew'), value: sub.autoRenew ? t('subscription.yes') : t('subscription.no') },
    { label: t('subscription.actualPrice'), value: String(sub.actualPrice) },
    { label: t('subscription.renewPrice'), value: String(sub.renewPrice) },
  ]
}

function onTabsWheel(e: WheelEvent) {
  const el = e.currentTarget as HTMLElement
  el.scrollLeft += e.deltaY
}

setInterval(() => { now.value = Date.now() }, 60000)

onMounted(() => {
  fetchData()
  // 监听主进程推送的数据更新
  window.electronAPI.onUsageDataUpdated((data) => {
    if (data) applyState(data)
  })
  // 监听窗口锁定状态
  window.electronAPI.onWindowPinnedState((pinned) => {
    isPinned.value = pinned
  })
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
  opacity: 1;
  margin-bottom: 8px;
  padding: 2px;
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
}
.account-tab:hover {
  border-color: var(--border-default);
}
.account-tab.active {
  color: var(--text-heading);
  font-weight: 600;
  border-color: var(--border-default);
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

.provider-name-row > .ft-wrapper {
  margin-left: auto;
  flex-shrink: 0;
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
  background: #ef4444;
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
</style>
