<!--
  设置页：服务商入口列表（两列网格）+ 通用设置（刷新间隔、开机自启、语言、主题、更新检查）。
  点击服务商入口进入同页内的配置详情页（ProviderSettingsPanel）；账户状态与自动保存逻辑都留在本组件，
  详情页经 actions 回调。
-->
<template>
  <div class="view-settings" @focusout="onSettingsFocusOut">
    <header class="header">
      <button class="icon-btn back-btn" :title="$t('settings.backBtn')" @click="onBackClick">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="15 18 9 12 15 6"/>
        </svg>
      </button>
      <Transition name="header-fade" mode="out-in">
        <h1 v-if="activeInfo" key="provider" class="header-provider">
          <ProviderLogo :provider-key="activeInfo.key" :size="16" />
          <span>{{ $t(`providers.${activeInfo.key}`) }}</span>
        </h1>
        <h1 v-else key="title">{{ $t('settings.title') }}</h1>
      </Transition>
    </header>

    <!--
      列表页与详情页叠放切换：两页都是占满本区域的整页，纯水平对滑（进入右进左出，返回反向）。
      搜索框属于列表页，随列表页一起滑走，不单独出现/消失，避免布局跳动。
    -->
    <div class="settings-stage">
      <Transition :name="activeProviderKey ? 'slide-left' : 'slide-right'">
        <!-- 服务商配置详情页 -->
        <div v-if="activeInfo" class="settings-page is-detail">
          <ProviderSettingsPanel :info="activeInfo" :actions="panelActions" />
        </div>

        <!-- 列表页：搜索框 + 服务商入口 + 通用设置 + 版本区 -->
        <div v-else class="settings-page is-list">
          <!-- 搜索框：实时过滤服务商入口与通用设置项 -->
          <div class="settings-search">
            <svg class="search-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input
              v-model="searchQuery"
              type="text"
              class="search-input"
              :placeholder="$t('settings.searchPlaceholder')"
            />
            <button v-if="searchQuery" class="search-clear" @click="searchQuery = ''" :title="$t('settings.searchPlaceholder')">×</button>
          </div>

          <div ref="settingsBodyRef" class="settings-body">
          <div v-if="searchNoMatch" class="no-match">{{ $t('settings.noMatch') }}</div>

          <template v-else>
            <div
              v-if="!searchActive || filteredProviderList.length > 0"
              class="section-label"
              :class="{ 'is-collapsed': collapsedSections.has('providers') }"
              @click="toggleSection('providers')"
            >
              <span class="section-toggle">{{ collapsedSections.has('providers') ? '▶' : '▼' }}</span>
              {{ $t('settings.providerSection') }}
              <span class="section-count">({{ filteredProviderList.length }})</span>
            </div>

            <Transition
              :css="false"
              @before-enter="collapseBeforeEnter"
              @enter="collapseEnter"
              @after-enter="collapseAfterEnter"
              @enter-cancelled="collapseReset"
              @before-leave="collapseBeforeLeave"
              @leave="collapseLeave"
              @after-leave="collapseAfterLeave"
              @leave-cancelled="collapseReset"
            >
              <div v-if="!collapsedSections.has('providers')" class="section-collapse">
                <div class="provider-grid">
                  <button
                    v-for="info in filteredProviderList"
                    :key="info.key"
                    type="button"
                    class="provider-tile"
                    @click="openProvider(info.key)"
                  >
                    <ProviderLogo :provider-key="info.key" />
                    <span class="provider-tile-name">{{ $t(`providers.${info.key}`) }}</span>
                  </button>
                </div>
              </div>
            </Transition>

            <div
              v-if="!searchActive || filteredGeneralKeys.size > 0"
              class="section-label"
              :class="{ 'is-collapsed': collapsedSections.has('general') }"
              @click="toggleSection('general')"
            >
              <span class="section-toggle">{{ collapsedSections.has('general') ? '▶' : '▼' }}</span>
              {{ $t('settings.generalSection') }}
            </div>

            <Transition
              :css="false"
              @before-enter="collapseBeforeEnter"
              @enter="collapseEnter"
              @after-enter="collapseAfterEnter"
              @enter-cancelled="collapseReset"
              @before-leave="collapseBeforeLeave"
              @leave="collapseLeave"
              @after-leave="collapseAfterLeave"
              @leave-cancelled="collapseReset"
            >
              <div v-if="!collapsedSections.has('general')" class="section-collapse">

                <div v-if="filteredGeneralKeys.size > 0" class="settings-card">
                  <div v-if="filteredGeneralKeys.has('refreshInterval')" class="form-group">
                    <label class="form-label">{{ $t('settings.refreshInterval') }}</label>
                    <select v-model="refreshInterval" class="form-select">
                      <option value="60">{{ $t('settings.interval1m') }}</option>
                      <option value="120">{{ $t('settings.interval2m') }}</option>
                      <option value="300">{{ $t('settings.interval5m') }}</option>
                      <option value="600">{{ $t('settings.interval10m') }}</option>
                      <option value="1800">{{ $t('settings.interval30m') }}</option>
                    </select>
                  </div>
                  <div v-if="filteredGeneralKeys.has('popupTrigger')" class="form-group">
                    <label class="form-label">{{ $t('settings.popupTriggerLabel') }}</label>
                    <select v-model="popupTrigger" class="form-select">
                      <option value="hover">{{ $t('settings.popupTriggerHover') }}</option>
                      <option value="click">{{ $t('settings.popupTriggerClick') }}</option>
                    </select>
                  </div>
                  <div v-if="filteredGeneralKeys.has('trayDisplayRule')" class="form-group">
                    <label class="form-label">{{ $t('settings.trayDisplayRule') }}</label>
                    <select v-model="trayDisplayRule" class="form-select">
                      <option value="off">{{ $t('settings.trayDisplayOff') }}</option>
                      <option value="lowest">{{ $t('settings.trayDisplayLowest') }}</option>
                      <option value="highest">{{ $t('settings.trayDisplayHighest') }}</option>
                      <option
                        v-for="opt in accountOptions"
                        :key="opt.value"
                        :value="opt.value"
                      >{{ opt.label }}</option>
                      <option v-if="disabledSelectedOption" :value="disabledSelectedOption.value">{{ disabledSelectedOption.label }}</option>
                    </select>
                  </div>
                  <div v-if="filteredGeneralKeys.has('language')" class="form-group">
                    <label class="form-label">{{ $t('settings.language') }}</label>
                    <select v-model="language" class="form-select">
                      <option value="zh-CN">中文</option>
                      <option value="en-US">English</option>
                    </select>
                  </div>
                  <div v-if="filteredGeneralKeys.has('theme')" class="form-group">
                    <label class="form-label">{{ $t('settings.theme') }}</label>
                    <select v-model="themePreference" class="form-select">
                      <option value="light">{{ $t('settings.themeLight') }}</option>
                      <option value="dark">{{ $t('settings.themeDark') }}</option>
                      <option value="auto">{{ $t('settings.themeAuto') }}</option>
                    </select>
                  </div>
                  <div v-if="generalTogglesVisible" class="toggle-group">
                    <!-- 商店版（MSIX）下注册表自启动无效，不提供该开关 -->
                    <label v-if="filteredGeneralKeys.has('autoStart') && !storeBuild" class="toggle-row">
                      <input type="checkbox" v-model="autoStart" :disabled="!isPackaged" />
                      <span class="toggle-switch"></span>
                      <span class="toggle-label">{{ $t('settings.autoStart') }}</span>
                      <span v-if="!isPackaged" class="dev-hint">{{ $t('settings.devModeHint') }}</span>
                    </label>
                    <label v-if="filteredGeneralKeys.has('memorySavingMode')" class="toggle-row" :title="$t('settings.memorySavingModeHint')">
                      <input type="checkbox" v-model="memorySavingMode" />
                      <span class="toggle-switch"></span>
                      <span class="toggle-label">{{ $t('settings.memorySavingMode') }}</span>
                    </label>
                    <label v-if="filteredGeneralKeys.has('rememberPopupPosition')" class="toggle-row" :title="$t('settings.rememberPopupPositionHint')">
                      <input type="checkbox" v-model="rememberPopupPosition" />
                      <span class="toggle-switch"></span>
                      <span class="toggle-label">{{ $t('settings.rememberPopupPosition') }}</span>
                    </label>
                    <label v-if="filteredGeneralKeys.has('showEstimatedCost')" class="toggle-row" :title="$t('settings.showEstimatedCostHint')">
                      <input type="checkbox" v-model="showEstimatedCost" />
                      <span class="toggle-switch"></span>
                      <span class="toggle-label">{{ $t('settings.showEstimatedCost') }}</span>
                    </label>
                    <label v-if="filteredGeneralKeys.has('autoCheckUpdate') && !storeBuild" class="toggle-row" :title="$t('settings.autoCheckUpdateHint')">
                      <input type="checkbox" v-model="autoCheckUpdateEnabled" />
                      <span class="toggle-switch"></span>
                      <span class="toggle-label">{{ $t('settings.autoCheckUpdate') }}</span>
                    </label>
                  </div>
                </div>

                <div v-if="!searchActive" class="version-section">
                  <div class="version-left">
                    <button class="icon-btn github-btn" title="GitHub" @click="openGitHub">
                      <img src="../assets/github.svg" alt="GitHub" />
                    </button>
                    <button class="feedback-link" @click="openFeedback">{{ $t('settings.feedback') }}</button>
                    <span class="version-text">v{{ appVersion }}</span>
                  </div>
                  <!-- 商店版更新由微软商店托管（政策 10.2.5），隐藏应用内更新入口 -->
                  <button
                    v-if="!storeBuild"
                    class="check-update-btn"
                    :class="{
                      'update-ready': updateState.phase === 'ready',
                      'has-update': updateState.phase === 'available'
                    }"
                    :disabled="updateState.phase === 'checking' || updateState.phase === 'downloading' || updateState.phase === 'noUpdate' || updateState.phase === 'error'"
                    @click="handleUpdateClick"
                  >
                    <template v-if="updateState.phase === 'checking'">{{ $t('settings.checkingUpdate') }}</template>
                    <template v-else-if="updateState.phase === 'downloading'">{{ $t('settings.downloading', { percent: updateState.progress ?? 0 }) }}</template>
                    <template v-else-if="updateState.phase === 'ready'">{{ $t('settings.restartToUpdate') }}</template>
                    <template v-else-if="updateState.phase === 'available'">{{ $t('settings.updateAvailable', { version: updateState.version }) }}</template>
                    <template v-else-if="updateState.phase === 'noUpdate'">{{ $t('settings.noUpdate') }}</template>
                    <template v-else-if="updateState.phase === 'error'">{{ $t('settings.updateFailed') }}</template>
                    <template v-else>{{ $t('settings.checkUpdate') }}</template>
                  </button>
                </div>
              </div>
            </Transition>
          </template>
          </div>
        </div>
      </Transition>
    </div>

    <footer class="footer">
      <span class="save-status" :class="{ error: saveError }">{{ saveStatus }}</span>
    </footer>

  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, nextTick, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AppConfig, ProviderTypeConfig, AccountConfig, UpdateStatus } from '../types'
import type { AccountInfo, ProviderInfo, ProviderSettingsActions, TestState } from '../components/settings/provider-settings-types'
import ProviderLogo from '../components/settings/ProviderLogo.vue'
import ProviderSettingsPanel from '../components/settings/ProviderSettingsPanel.vue'
import { useTheme } from '../composables/useTheme'
import { maskApiKey } from '@/shared/mask'

const emit = defineEmits<{ 'go-back': [] }>()
const props = defineProps<{ autoCheckUpdate?: boolean }>()

const { t, locale } = useI18n()
const { preference: themePreference, setTheme } = useTheme()

const providerList = ref<ProviderInfo[]>([])
const refreshInterval = ref('300')
const autoStart = ref(false)
const isPackaged = ref(true)
const storeBuild = ref(false)
const language = ref('zh-CN')
const popupTrigger = ref<'hover' | 'click'>('hover')
const memorySavingMode = ref(false)
const rememberPopupPosition = ref(false)
const showEstimatedCost = ref(false)
const trayDisplayRule = ref<string>('lowest')
const autoCheckUpdateEnabled = ref(true)
const saving = ref(false)
const settingsBodyRef = ref<HTMLElement | null>(null)
const saveStatus = ref('')
const saveError = ref(false)
const currentConfig = ref<AppConfig | null>(null)

/**
 * 搜索 + section 折叠
 * - searchQuery: 用户输入的关键字（实时过滤）
 * - collapsedSections: 哪些 section 被折叠（key = section id）
 * - filteredProviderList: 搜索后剩下的 provider 列表（不修改原数据）
 * - filteredGeneralKeys: 通用区命中的设置项 key（无关键字时为全部）
 * 搜索时无命中的 section 整体隐藏；两区皆无命中才显示「没有匹配项」
 */
const GENERAL_SEARCH_ITEMS: { key: string; label: string }[] = [
  { key: 'refreshInterval', label: 'settings.refreshInterval' },
  { key: 'popupTrigger', label: 'settings.popupTriggerLabel' },
  { key: 'trayDisplayRule', label: 'settings.trayDisplayRule' },
  { key: 'language', label: 'settings.language' },
  { key: 'theme', label: 'settings.theme' },
  { key: 'autoStart', label: 'settings.autoStart' },
  { key: 'memorySavingMode', label: 'settings.memorySavingMode' },
  { key: 'rememberPopupPosition', label: 'settings.rememberPopupPosition' },
  { key: 'showEstimatedCost', label: 'settings.showEstimatedCost' },
  { key: 'autoCheckUpdate', label: 'settings.autoCheckUpdate' },
]
const GENERAL_TOGGLE_KEYS = ['autoStart', 'memorySavingMode', 'rememberPopupPosition', 'showEstimatedCost', 'autoCheckUpdate']

const searchQuery = ref('')
const collapsedSections = ref<Set<string>>(new Set())
function toggleSection(id: string) {
  const s = new Set(collapsedSections.value)
  if (s.has(id)) s.delete(id); else s.add(id)
  collapsedSections.value = s
}
const filteredProviderList = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  if (!q) return providerList.value
  return providerList.value.filter(info => {
    // 匹配 provider 名
    const providerName = t(`providers.${info.key}`).toLowerCase()
    if (providerName.includes(q)) return true
    // 匹配账号 label
    if (info.accounts.some(a => (a.label || '').toLowerCase().includes(q))) return true
    return false
  })
})
const searchActive = computed(() => searchQuery.value.trim() !== '')
const filteredGeneralKeys = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  return new Set(
    GENERAL_SEARCH_ITEMS
      .filter(item => t(item.label).toLowerCase().includes(q))
      .map(item => item.key),
  )
})
const generalTogglesVisible = computed(() =>
  GENERAL_TOGGLE_KEYS.some(key => filteredGeneralKeys.value.has(key)),
)
const searchNoMatch = computed(() =>
  searchActive.value && filteredProviderList.value.length === 0 && filteredGeneralKeys.value.size === 0,
)

/**
 * 服务商配置详情页：设置页内的二级页面（非顶层视图），activeProviderKey 为空时显示列表页。
 * 详情页只切换渲染，providerList 等状态与自动保存逻辑不迁移。
 */
const activeProviderKey = ref<string | null>(null)
const activeInfo = computed<ProviderInfo | null>(() =>
  providerList.value.find(p => p.key === activeProviderKey.value) ?? null,
)
// 进入详情页前记下列表页的滚动位置，返回时恢复
let listScrollTop = 0

function openProvider(key: string) {
  listScrollTop = settingsBodyRef.value?.scrollTop ?? 0
  activeProviderKey.value = key
}

function closeProvider() {
  activeProviderKey.value = null
  // 列表页在切换时重新挂载，等 DOM 更新后再恢复滚动位置
  nextTick(() => {
    if (settingsBodyRef.value) settingsBodyRef.value.scrollTop = listScrollTop
  })
}

function onBackClick() {
  if (activeProviderKey.value) closeProvider()
  else emit('go-back')
}

// 下传给详情页的动作：全部落在本组件，改动 providerList 即触发自动保存
const panelActions: ProviderSettingsActions = {
  addAccount,
  removeAccount,
  getTestState,
  testTitle,
  testConnection,
  deepseekWebLogin: handleWebLogin,
  deepseekWebLogout: handleWebLogout,
  mimoWebLogin: handleMimoWebLogin,
  mimoWebLogout: handleMimoWebLogout,
  qoderWebLogin: handleQoderWebLogin,
  qoderWebLogout: handleQoderWebLogout,
  qwenWebLogin: handleQwenWebLogin,
  qwenWebLogout: handleQwenWebLogout,
  stepfunWebLogin: handleStepfunWebLogin,
  stepfunWebLogout: handleStepfunWebLogout,
  onApiKeyInput,
  onQoderCaptureInput,
  validateQoderCapture,
  qoderSiteName,
  onStepfunTokenInput,
}
const accountOptions = computed(() => {
  const options: { value: string; label: string }[] = []
  for (const info of providerList.value) {
    const providerName = t(`providers.${info.key}`)
    for (const account of info.accounts) {
      // 仅列出启用中的账户；已禁用账户不占选项位
      if (!account.enabled) continue
      const label = account.label || t('main.defaultAccountLabel', { n: info.accounts.indexOf(account) + 1 })
      options.push({
        value: `${info.key}:${account.id}`,
        label: `${providerName} - ${label}`,
      })
    }
  }
  return options
})

// 当前选中但已禁用的账户：以占位选项展示（托盘显示 --），
// 重新启用后该账户回到正常选项列表，无需手动重选
const disabledSelectedOption = computed(() => {
  const value = trayDisplayRule.value
  if (value === 'lowest' || value === 'highest' || value === 'off') return null
  const sep = value.indexOf(':')
  if (sep <= 0) return null
  const type = value.slice(0, sep)
  const accountId = value.slice(sep + 1)
  const info = providerList.value.find(p => p.key === type)
  const account = info?.accounts.find(a => a.id === accountId)
  if (!info || !account || account.enabled) return null
  const providerName = t(`providers.${info.key}`)
  const label = account.label || t('main.defaultAccountLabel', { n: info.accounts.indexOf(account) + 1 })
  return { value, label: `${providerName} - ${label}（${t('settings.trayDisplayAccountDisabled')}）` }
})
const appVersion = ref('')
const updateState = ref<UpdateStatus>({ phase: 'idle' })
let saveTimer: ReturnType<typeof setTimeout> | null = null
let saveDeferredByFocus = false

// 判断当前焦点是否在文本类输入框（text/password）上；
// checkbox/radio/select 不算 —— 它们的变更需要即时防抖保存
function focusedTypingInput(): boolean {
  const el = document.activeElement
  return el instanceof HTMLInputElement && (el.type === 'text' || el.type === 'password')
}

function generateId(): string {
  return Math.random().toString(16).slice(2, 10)
}

function addAccount(providerKey: string) {
  const provider = providerList.value.find(p => p.key === providerKey)
  if (!provider) return
  const account: AccountInfo = {
    id: generateId(),
    label: '',
    enabled: true,
    apiKey: '',
    maskedApiKey: '',
    authMode: (providerKey === 'mimo' || providerKey === 'codex' || providerKey === 'qoder' || providerKey === 'stepfun' || providerKey === 'qwen') ? 'weblogin' : 'apikey',
    webTokenStatus: 'none',
    apiKeyDirty: false,
    qoderCookieSource: 'session',
    qoderSite: 'international',
    qoderManualCapture: '',
    qoderCaptureDirty: false,
    qoderHasWebToken: false,
    stepfunCookieSource: 'session',
    stepfunManualToken: '',
    stepfunTokenDirty: false,
    stepfunHasWebToken: false,
    region: 'cn',
  }
  provider.accounts.push(account)
}

/**
 * 删除账号：已登录的网页登录账号先登出（清登录态与 session Cookie），
 * 无论登出是否成功都按 id 移除，避免残留一个无法清理的账号。
 */
async function removeAccount(providerKey: string, accountId: string) {
  const provider = providerList.value.find(p => p.key === providerKey)
  if (!provider) return
  const account = provider.accounts.find(a => a.id === accountId)
  if (!account) return
  if (account.webTokenStatus === 'active') {
    const logout = LOGOUT_HANDLERS[providerKey]
    if (logout) {
      try {
        await logout(account)
      } catch {
        // 登出失败也继续移除
      }
    }
  }
  const index = provider.accounts.findIndex(a => a.id === accountId)
  if (index !== -1) provider.accounts.splice(index, 1)
}

/**
 * section 折叠/展开的高度过渡：内容高度不定，
 * 用 JS 钩子在 0 与 scrollHeight 之间过渡，结束后还原为自动高度。
 */
const COLLAPSE_DURATION = 200

function collapseBeforeEnter(el: Element) {
  const e = el as HTMLElement
  e.style.height = '0'
  e.style.overflow = 'hidden'
}
function collapseEnter(el: Element, done: () => void) {
  const e = el as HTMLElement
  e.style.height = `${e.scrollHeight}px`
  setTimeout(done, COLLAPSE_DURATION + 50)
}
function collapseAfterEnter(el: Element) {
  collapseReset(el)
}
function collapseBeforeLeave(el: Element) {
  const e = el as HTMLElement
  e.style.height = `${e.scrollHeight}px`
  e.style.overflow = 'hidden'
}
function collapseLeave(el: Element, done: () => void) {
  const e = el as HTMLElement
  // 强制回流，让固定高度先生效后再过渡到 0
  void e.offsetHeight
  e.style.height = '0'
  setTimeout(done, COLLAPSE_DURATION + 50)
}
function collapseAfterLeave(el: Element) {
  collapseReset(el)
}
function collapseReset(el: Element) {
  const e = el as HTMLElement
  e.style.height = ''
  e.style.overflow = ''
}

// 测试连接状态：键为 "providerKey:accountId"
const testStates = ref<Record<string, TestState>>({})

function getTestState(providerKey: string, accountId: string): TestState | undefined {
  return testStates.value[`${providerKey}:${accountId}`]
}

function testTitle(providerKey: string, accountId: string): string {
  const state = getTestState(providerKey, accountId)
  if (state?.status === 'success') {
    return `${t('settings.testSuccess')} · ${t('settings.testLatency', { ms: state.latencyMs ?? 0 })}`
  }
  if (state?.status === 'failed') return state.error || t('settings.testFailed')
  return t('settings.testConnection')
}

// 5s 后自动清除成功状态的 timer handle（按 key 索引）
// 连续点击同一账户时取消上一次的延迟清除，避免状态错乱；卸载时统一清空
const testAutoClearTimers = new Map<string, ReturnType<typeof setTimeout>>()
function clearTestAutoClearTimer(key: string) {
  const handle = testAutoClearTimers.get(key)
  if (handle) {
    clearTimeout(handle)
    testAutoClearTimers.delete(key)
  }
}

async function testConnection(info: ProviderInfo, account: AccountInfo) {
  const key = `${info.key}:${account.id}`
  clearTestAutoClearTimer(key)
  testStates.value[key] = { status: 'testing' }
  // 客户端保险：IPC 自身卡死时也能 bail（12s > 后端 8s，留 4s 余量）
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => reject(new Error('客户端超时（12s）')), 12000)
  })
  try {
    const params: Parameters<typeof window.electronAPI.testProviderConnection>[0] = {
      providerKey: info.key,
      accountId: account.id,
      authMode: account.authMode,
    }
    // 输入框里改过且非空时直接测新 key，否则测已保存的 key
    if (account.apiKeyDirty && account.apiKey) {
      params.apiKey = account.apiKey
    }
    // 智谱/阶跃：按当前站点区域测试对应域名
    if (info.key === 'zhipu' || info.key === 'stepfun') {
      params.region = account.region ?? 'cn'
    }
    // Qoder：按当前 UI 模式测试；手动模式粘贴内容变更时直接测新捕获
    if (info.key === 'qoder') {
      params.qoderCookieSource = account.qoderCookieSource ?? 'session'
      params.qoderSite = account.qoderSite ?? 'international'
      if (account.qoderCookieSource === 'manual' && account.qoderCaptureDirty && account.qoderManualCapture.trim()) {
        params.webToken = account.qoderManualCapture
      }
    }
    // StepFun：按当前 UI 模式测试；手动模式 Token 变更时直接测新粘贴值
    if (info.key === 'stepfun') {
      params.stepfunCookieSource = account.stepfunCookieSource ?? 'session'
      if (account.stepfunCookieSource === 'manual' && account.stepfunTokenDirty && account.stepfunManualToken.trim()) {
        params.webToken = account.stepfunManualToken
      }
    }
    const result = await Promise.race([
      window.electronAPI.testProviderConnection(params),
      timeoutPromise,
    ])
    if (result.ok) {
      testStates.value[key] = {
        status: 'success',
        latencyMs: result.latencyMs,
        sample: result.sample,
      }
    } else {
      testStates.value[key] = { status: 'failed', error: result.error }
    }
  } catch (e) {
    testStates.value[key] = { status: 'failed', error: e instanceof Error ? e.message : String(e) }
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle)
  }
  // 5s 后自动复位成功状态
  if (testStates.value[key].status === 'success') {
    const handle = setTimeout(() => {
      if (testStates.value[key]?.status === 'success') testStates.value[key] = { status: 'idle' }
      testAutoClearTimers.delete(key)
    }, 5000)
    testAutoClearTimers.set(key, handle)
  }
}

async function handleWebLogin(account: AccountInfo) {
  const result = await window.electronAPI.deepseekWebLogin(account.id)
  if (result.success) {
    account.webTokenStatus = 'active'
    // 重新拉取配置，确保 local state 与主进程同步
    const freshConfig = await window.electronAPI.getConfig()
    if (freshConfig) currentConfig.value = freshConfig
  }
}

async function handleWebLogout(account: AccountInfo) {
  await window.electronAPI.deepseekWebLogout(account.id)
  account.webTokenStatus = 'none'
  const freshConfig = await window.electronAPI.getConfig()
  if (freshConfig) currentConfig.value = freshConfig
}

async function handleMimoWebLogin(account: AccountInfo) {
  const result = await window.electronAPI.mimoWebLogin(account.id)
  if (result.success) {
    account.webTokenStatus = 'active'
    const freshConfig = await window.electronAPI.getConfig()
    if (freshConfig) currentConfig.value = freshConfig
  }
}

async function handleMimoWebLogout(account: AccountInfo) {
  await window.electronAPI.mimoWebLogout(account.id)
  account.webTokenStatus = 'none'
  const freshConfig = await window.electronAPI.getConfig()
  if (freshConfig) currentConfig.value = freshConfig
}

async function handleQoderWebLogin(account: AccountInfo) {
  const site = account.qoderSite === 'china' ? 'china' : 'international'
  const result = await window.electronAPI.qoderWebLogin(account.id, site)
  if (result.success) {
    // 登录在主进程写入了配置，同步本地状态避免自动保存回退字段
    account.qoderCookieSource = 'session'
    account.qoderSite = site
    account.webTokenStatus = 'active'
    const freshConfig = await window.electronAPI.getConfig()
    if (freshConfig) currentConfig.value = freshConfig
  }
}

async function handleQoderWebLogout(account: AccountInfo) {
  await window.electronAPI.qoderWebLogout(account.id)
  account.webTokenStatus = 'none'
  const freshConfig = await window.electronAPI.getConfig()
  if (freshConfig) currentConfig.value = freshConfig
}

async function handleQwenWebLogin(account: AccountInfo) {
  const region = account.region === 'global' ? 'global' : 'cn'
  const result = await window.electronAPI.qwenWebLogin(account.id, region)
  if (result.success) {
    // 登录在主进程写入了 token 与站点区域，同步本地状态避免自动保存回退字段
    account.region = region
    account.webTokenStatus = 'active'
    const freshConfig = await window.electronAPI.getConfig()
    if (freshConfig) currentConfig.value = freshConfig
  }
}

async function handleQwenWebLogout(account: AccountInfo) {
  await window.electronAPI.qwenWebLogout(account.id)
  account.webTokenStatus = 'none'
  const freshConfig = await window.electronAPI.getConfig()
  if (freshConfig) currentConfig.value = freshConfig
}

async function handleStepfunWebLogin(account: AccountInfo) {
  const result = await window.electronAPI.stepfunWebLogin(account.id, account.region ?? 'cn')
  if (result.success) {
    // 登录在主进程写入了配置，同步本地状态避免自动保存回退字段
    account.stepfunCookieSource = 'session'
    account.webTokenStatus = 'active'
    const freshConfig = await window.electronAPI.getConfig()
    if (freshConfig) currentConfig.value = freshConfig
  }
}

async function handleStepfunWebLogout(account: AccountInfo) {
  await window.electronAPI.stepfunWebLogout(account.id)
  account.webTokenStatus = 'none'
  const freshConfig = await window.electronAPI.getConfig()
  if (freshConfig) currentConfig.value = freshConfig
}

const LOGOUT_HANDLERS: Record<string, (account: AccountInfo) => Promise<void>> = {
  deepseek: handleWebLogout,
  mimo: handleMimoWebLogout,
  qoder: handleQoderWebLogout,
  qwen: handleQwenWebLogout,
  stepfun: handleStepfunWebLogout,
}

function onStepfunTokenInput(account: AccountInfo) {
  account.stepfunTokenDirty = true
  scheduleSave()
}

function onQoderCaptureInput(account: AccountInfo) {
  account.qoderCaptureDirty = true
}

/** 失焦时解析粘贴内容，即时反馈识别站点与 Cookie 数量 */
async function validateQoderCapture(account: AccountInfo) {
  if (!account.qoderCaptureDirty) return
  if (!account.qoderManualCapture.trim()) {
    account.qoderParse = undefined
    return
  }
  account.qoderParse = await window.electronAPI.qoderParseManual(account.qoderManualCapture)
}

function qoderSiteName(site?: string): string {
  if (site === 'china') return t('settings.siteChina')
  if (site === 'international') return t('settings.siteInternational')
  return site ?? ''
}

function scheduleSave() {
  // 文本输入框（text/password）聚焦期间挂起自动保存：
  // 防抖计时器若在用户慢速输入中途触发，保存后会清空明文并重建输入框，
  // 导致正在输入的内容被截断、需要从头重输；失焦时再立即落盘
  if (focusedTypingInput()) {
    saveDeferredByFocus = true
    // 挂起前清掉已排队的防抖，避免旧的计时器仍在本轮聚焦中途触发保存
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
    return
  }
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    saveConfig()
  }, 500)
}

// 失焦后若期间挂起过保存则立即落盘；
// requestAnimationFrame 用于跳过「焦点从一个文本框直接移到另一个文本框」的中间态
function onSettingsFocusOut() {
  requestAnimationFrame(() => {
    if (saveDeferredByFocus && !focusedTypingInput()) {
      saveDeferredByFocus = false
      saveConfig()
    }
  })
}

// 监听与 watch 的清理句柄：必须在 setup 顶层声明并清理；
// onMounted 内 await 之后注册的 onUnmounted/watch 不会绑定到组件实例，会导致泄漏
let offUpdateStatus: (() => void) | null = null
let offTriggerCheckUpdate: (() => void) | null = null
const stopWatches: Array<() => void> = []
// 卸载标记：防止 async onMounted 在组件卸载后继续注册 watch/listener
let disposed = false

/**
 * API Key 输入处理：用户主动输入新值时才标记 dirty 并填入 apiKey。
 * 注意不能用 v-model 直接绑定 account.apiKey —— 否则页面回填的脱敏掩码
 * （如 76f2****zFwz）会被当成新密钥在保存时写回，污染密钥。
 */
function onApiKeyInput(account: AccountInfo, event: Event) {
  account.apiKey = (event.target as HTMLInputElement).value
  account.apiKeyDirty = true
  scheduleSave()
}

onMounted(async () => {
  appVersion.value = await window.electronAPI.getAppVersion()
  storeBuild.value = (await window.electronAPI.getBuildInfo()).storeBuild
  if (disposed) return
  const config = await window.electronAPI.getConfig()
  if (disposed || !config) return
  currentConfig.value = config

  // 从主进程获取可用的 provider 列表
  const availableKeys: string[] = await window.electronAPI.getAvailableProviders()
  if (disposed) return

  providerList.value = availableKeys.map(key => {
    const providerConfig = config.providers[key] as ProviderTypeConfig | undefined
    const accounts: AccountInfo[] = (providerConfig?.accounts ?? []).map((account: AccountConfig): AccountInfo => ({
      id: account.id,
      label: account.label ?? '',
      enabled: account.enabled ?? false,
      // 主进程返回的 apiKey 是脱敏掩码（前4+****+后4），不能直接当明文用，
      // 否则保存时会把掩码当成新密钥写回，导致密钥被污染。
      // 这里把掩码存到 maskedApiKey 仅用于输入框占位提示，apiKey 清空，
      // 只有用户主动输入新值（onApiKeyInput）才会填入 apiKey 并参与保存。
      maskedApiKey: account.apiKey ?? '',
      apiKey: '',
      budget: (account as any).budget ?? undefined,
      authMode: (key === 'mimo' || key === 'codex' || key === 'qoder' || key === 'stepfun' || key === 'qwen') ? (account.authMode ?? 'weblogin') : (account.authMode ?? 'apikey'),
      webTokenStatus: key === 'mimo'
        ? ((account as any).mimoLoggedIn ? 'active' : 'none')
        : key === 'codex'
          ? 'none'
          : key === 'qoder'
            ? ((account as any).qoderCookieSource !== 'manual' && (account as any).qoderLoggedIn ? 'active' : 'none')
            : key === 'stepfun'
              ? ((account as any).stepfunCookieSource !== 'manual' && (account as any).stepfunLoggedIn ? 'active' : 'none')
              : (account.hasWebToken ? 'active' : 'none'),
      apiKeyDirty: false,
      qoderCookieSource: (account as any).qoderCookieSource ?? 'session',
      qoderSite: (account as any).qoderSite ?? 'international',
      qoderManualCapture: '',
      qoderCaptureDirty: false,
      qoderHasWebToken: !!account.hasWebToken,
      qoderParse: undefined,
      stepfunCookieSource: (account as any).stepfunCookieSource ?? 'session',
      stepfunManualToken: '',
      stepfunTokenDirty: false,
      stepfunHasWebToken: !!account.hasWebToken,
      region: account.region === 'global' ? 'global' : 'cn',
    }))

    // Codex: 确保始终有一个默认账户
    if (key === 'codex' && accounts.length === 0) {
      accounts.push({
        id: generateId(),
        label: 'Codex',
        enabled: false,
        apiKey: '',
        maskedApiKey: '',
        authMode: 'weblogin',
        webTokenStatus: 'none',
        apiKeyDirty: false,
        qoderManualCapture: '',
        qoderCaptureDirty: false,
        qoderHasWebToken: false,
        stepfunCookieSource: 'session',
        stepfunManualToken: '',
        stepfunTokenDirty: false,
        stepfunHasWebToken: false,
      })
    }

    return {
      key,
      label: t(`providers.${key}`),
      accounts,
    }
  })
  refreshInterval.value = String(config.refreshInterval)
  autoStart.value = config.autoStart
  isPackaged.value = (config as any).isPackaged ?? true
  language.value = config.language || locale.value
  popupTrigger.value = config.popupTrigger ?? 'hover'
  memorySavingMode.value = config.memorySavingMode ?? false
  rememberPopupPosition.value = config.rememberPopupPosition ?? false
  showEstimatedCost.value = config.showEstimatedCost ?? false
  trayDisplayRule.value = config.trayDisplayRule ?? 'lowest'
  autoCheckUpdateEnabled.value = config.autoCheckUpdate ?? true

  // 配置加载完后开始监听变化，自动保存
  stopWatches.push(watch([providerList, refreshInterval, autoStart, language, popupTrigger, memorySavingMode, rememberPopupPosition, showEstimatedCost, trayDisplayRule, autoCheckUpdateEnabled], () => {
    scheduleSave()
  }, { deep: true }))

  // 选中的账户被删除时回退到最低额度；仅被禁用时保留选择（托盘显示 --）
  stopWatches.push(watch(accountOptions, (opts) => {
    if (trayDisplayRule.value === 'lowest' || trayDisplayRule.value === 'highest' || trayDisplayRule.value === 'off') return
    if (disabledSelectedOption.value) return
    if (!opts.some(o => o.value === trayDisplayRule.value)) {
      trayDisplayRule.value = 'lowest'
    }
  }))

  // 主题切换由 useTheme 自行持久化，不经过 scheduleSave
  stopWatches.push(watch(themePreference, (val) => {
    setTheme(val)
  }))

  // 恢复主进程的更新状态
  if (config.updateStatus) {
    updateState.value = config.updateStatus
  }

  // 监听主进程推送的更新状态变化
  offUpdateStatus = window.electronAPI.onUpdateStatusChanged((status) => {
    updateState.value = status
  })

  // 监听来自托盘菜单的检查更新事件（兼容旧路径）
  const onTriggerCheckUpdate = () => {
    settingsBodyRef.value?.scrollTo({ top: settingsBodyRef.value.scrollHeight })
    if (!storeBuild.value && (updateState.value.phase === 'idle' || updateState.value.phase === 'noUpdate' || updateState.value.phase === 'error')) {
      window.electronAPI.checkForUpdate()
    }
  }
  offTriggerCheckUpdate = window.electronAPI.onTriggerCheckUpdate(onTriggerCheckUpdate)

  // 从托盘菜单或更新浮窗进入时，滚到底部；若已有更新信息则不再重复检查
  if (props.autoCheckUpdate && !storeBuild.value) {
    nextTick(() => {
      if (disposed) return
      settingsBodyRef.value?.scrollTo({ top: settingsBodyRef.value.scrollHeight })
      const phase = updateState.value.phase
      if (phase === 'idle' || phase === 'noUpdate' || phase === 'error') {
        window.electronAPI.checkForUpdate()
      }
      window.electronAPI.showPopup()
    })
  }
})

onUnmounted(() => {
  disposed = true

  // 清理所有测试连接的延迟复位 timer，避免组件销毁后仍触发
  for (const handle of testAutoClearTimers.values()) clearTimeout(handle)
  testAutoClearTimers.clear()

  offTriggerCheckUpdate?.()
  offTriggerCheckUpdate = null

  offUpdateStatus?.()
  offUpdateStatus = null

  stopWatches.splice(0).forEach(stop => stop())
})

async function saveConfig() {
  if (!currentConfig.value) return
  saving.value = true
  saveStatus.value = t('settings.saving')
  saveError.value = false

  const providers: Record<string, { accounts: Partial<AccountConfig>[] }> = {}
  // 记录本次携带新密钥的账户，保存成功后再回填脱敏占位并清理明文；
  // 不能在构建 update 时就翻转 apiKeyDirty —— 那会让输入框在保存完成前
  // 突然清空（表现为抖动后显示空白），且失败时用户输入会丢失
  const pendingKeys: Array<{ account: AccountInfo; key: string }> = []
  for (const info of providerList.value) {
    providers[info.key] = {
      accounts: info.accounts.map((a): Partial<AccountConfig> => {
        const update: Partial<AccountConfig> = {
          id: a.id,
          label: a.label,
          enabled: a.enabled,
          authMode: a.authMode,
        }
        if (a.budget != null) update.budget = a.budget
        if (info.key === 'zhipu' || info.key === 'stepfun' || info.key === 'qwen') {
          update.region = a.region ?? 'cn'
        }
        if (a.apiKeyDirty) {
          update.apiKey = a.apiKey
          pendingKeys.push({ account: a, key: a.apiKey })
        }
        if (info.key === 'qoder') {
          update.qoderCookieSource = a.qoderCookieSource ?? 'session'
          update.qoderSite = a.qoderSite ?? 'international'
          // 粘贴内容存于 webToken（主进程加密）；仅在变更时发送，
          // 或从 manual 切回 session 时清除残留捕获
          if (a.qoderCaptureDirty || (a.qoderCookieSource !== 'manual' && a.qoderHasWebToken)) {
            update.webToken = a.qoderCookieSource === 'manual' ? a.qoderManualCapture : ''
          }
        }
        if (info.key === 'stepfun') {
          update.stepfunCookieSource = a.stepfunCookieSource ?? 'session'
          // Oasis-Token 存于 webToken（主进程加密）；仅在变更时发送，
          // 或从 manual 切回 session 时清除残留 Token
          if (a.stepfunTokenDirty || (a.stepfunCookieSource !== 'manual' && a.stepfunHasWebToken)) {
            update.webToken = a.stepfunCookieSource === 'manual' ? a.stepfunManualToken.trim() : ''
          }
        }
        return update
      })
    }
  }

  try {
    await window.electronAPI.updateConfig({
      providers,
      refreshInterval: parseInt(refreshInterval.value, 10),
      autoStart: autoStart.value,
      popupTrigger: popupTrigger.value,
      memorySavingMode: memorySavingMode.value,
      rememberPopupPosition: rememberPopupPosition.value,
      showEstimatedCost: showEstimatedCost.value,
      language: language.value,
      trayDisplayRule: trayDisplayRule.value,
      autoCheckUpdate: autoCheckUpdateEnabled.value,
    })
    // 保存成功：立即回填脱敏掩码，输入框从「明文」切到「掩码占位」，
    // 用户无需重进页面即可确认已保存；明文密钥不再留在渲染进程内存
    for (const { account, key } of pendingKeys) {
      // 保存期间用户又输入了新内容时，保留其编辑状态交给下一次保存
      if (account.apiKeyDirty && account.apiKey !== key) continue
      account.maskedApiKey = maskApiKey(key)
      account.apiKey = ''
      account.apiKeyDirty = false
    }
    // Qoder：保存成功后重置捕获编辑状态，回填"已保存"标记
    for (const info of providerList.value) {
      if (info.key !== 'qoder') continue
      for (const account of info.accounts) {
        if (!account.qoderCaptureDirty) continue
        account.qoderCaptureDirty = false
        account.qoderHasWebToken = account.qoderCookieSource === 'manual' && account.qoderManualCapture.trim() !== ''
      }
    }
    // StepFun：保存成功后重置 Token 编辑状态，回填"已保存"标记
    for (const info of providerList.value) {
      if (info.key !== 'stepfun') continue
      for (const account of info.accounts) {
        if (!account.stepfunTokenDirty) continue
        account.stepfunTokenDirty = false
        account.stepfunHasWebToken = account.stepfunCookieSource === 'manual' && account.stepfunManualToken.trim() !== ''
      }
    }
    locale.value = language.value
    saveStatus.value = t('settings.saved')
    setTimeout(() => { saveStatus.value = '' }, 2000)
  } catch (e) {
    console.error('[Settings] Save failed:', e)
    saveStatus.value = t('settings.saveFailed')
    saveError.value = true
  } finally {
    saving.value = false
  }
}

function openGitHub() {
  window.electronAPI.openExternal('https://github.com/hyizhou/coding-quota-bar')
}

function openFeedback() {
  window.electronAPI.openExternal('https://github.com/hyizhou/coding-quota-bar/discussions')
}

function handleUpdateClick() {
  const phase = updateState.value.phase
  if (phase === 'ready') {
    window.electronAPI.quitAndInstall()
  } else if (phase === 'available') {
    window.electronAPI.downloadUpdate()
  } else if (phase === 'idle' || phase === 'noUpdate' || phase === 'error') {
    window.electronAPI.checkForUpdate()
  }
}
</script>

<style scoped>
.view-settings {
  display: flex;
  flex-direction: column;
  height: 100%;
}

/* 列表页与详情页叠放在同一容器内左右滑动，容器本身不滚动 */
.settings-stage {
  position: relative;
  flex: 1;
  overflow: hidden;
  min-height: 0;
}

/* 列表页内的滚动区（搜索框固定在其上方，不随内容滚动） */
.settings-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.settings-page {
  position: absolute;
  inset: 0;
}

.settings-page.is-list {
  display: flex;
  flex-direction: column;
}

.settings-body::-webkit-scrollbar,
.settings-page.is-detail::-webkit-scrollbar { width: 3px; }
.settings-body::-webkit-scrollbar-thumb,
.settings-page.is-detail::-webkit-scrollbar-thumb { background: var(--scrollbar-thumb); border-radius: 2px; }

.settings-page.is-detail {
  padding: 10px 10px 0;
}

/* 标题切换：旧标题快速淡出，新标题稍延迟淡入 */
.header-fade-enter-active {
  transition: opacity 0.14s ease 0.05s;
}
.header-fade-leave-active {
  transition: opacity 0.08s ease;
}
.header-fade-enter-from,
.header-fade-leave-to {
  opacity: 0;
}

/* 页面切换过渡：两页纯水平对滑，进入右进左出，返回反向 */
.slide-left-enter-active,
.slide-right-enter-active,
.slide-left-leave-active,
.slide-right-leave-active {
  transition: transform 0.26s cubic-bezier(0.4, 0, 0.2, 1);
  will-change: transform;
}

.slide-left-enter-from { transform: translateX(100%); }
.slide-left-leave-to { transform: translateX(-100%); }
.slide-right-enter-from { transform: translateX(-100%); }
.slide-right-leave-to { transform: translateX(100%); }

.header-provider {
  display: flex;
  align-items: center;
  gap: 6px;
}

.settings-card {
  background: var(--bg-settings-card);
  border-radius: 8px;
  padding: 10px 12px;
  margin-bottom: 6px;
}

/* section 折叠/展开过渡：height 由 JS 钩子驱动 */
.section-collapse {
  transition: height 0.2s ease;
}

/* === 搜索 + section 折叠 === */
.settings-search {
  position: relative;
  margin: 8px 10px 0;
}
.settings-search .search-icon {
  position: absolute;
  left: 8px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--text-tertiary);
  pointer-events: none;
}
.search-input {
  width: 100%;
  padding: 5px 26px 5px 26px;
  border: 1px solid var(--border-default);
  border-radius: 5px;
  background: var(--bg-input);
  color: var(--text-primary);
  font-size: 12px;
  outline: none;
  transition: border-color 0.15s;
}
.search-input:focus {
  border-color: var(--text-tertiary);
}
.search-input::placeholder { color: var(--text-tertiary); }
.search-clear {
  position: absolute;
  right: 4px;
  top: 50%;
  transform: translateY(-50%);
  width: 18px;
  height: 18px;
  padding: 0;
  background: transparent;
  border: none;
  color: var(--text-tertiary);
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
  border-radius: 3px;
}
.search-clear:hover { color: var(--text-primary); background: var(--border-subtle); }

.section-label {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  padding: 4px 10px;
  margin: 4px 0 4px;
  cursor: pointer;
  user-select: none;
  border-radius: 4px;
  transition: background 0.15s;
}
.section-label:hover { background: var(--bg-input); }
.section-label .section-toggle {
  font-size: 9px;
  color: var(--text-tertiary);
  transition: transform 0.2s;
}
.section-label.is-collapsed { margin-bottom: 4px; }
.section-label .section-count {
  color: var(--text-tertiary);
  font-weight: 400;
  font-size: 10px;
  margin-left: auto;
  opacity: 0.7;
}
.no-match {
  text-align: center;
  font-size: 11px;
  color: var(--text-tertiary);
  padding: 12px;
  font-style: italic;
}

/* 服务商入口：两列网格，点击进入该服务商的配置详情页 */
.provider-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
}

.provider-tile {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  padding: 8px 10px;
  border: none;
  border-radius: 8px;
  background: var(--bg-settings-card);
  color: var(--text-heading);
  font-family: inherit;
  font-size: 12px;
  font-weight: 600;
  text-align: left;
  cursor: pointer;
  transition: background 0.2s, box-shadow 0.2s;
}
.provider-tile:hover {
  background: var(--bg-card-hover);
  box-shadow: var(--shadow-card-hover);
}
.provider-tile:focus-visible {
  outline: 2px solid var(--border-focus);
  outline-offset: -2px;
}

.provider-tile-name {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.save-status { font-size: 11px; color: #4CAF50; }
.save-status.error { color: #F44336; }

.version-section {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  margin-top: 4px;
}

.version-left {
  display: flex;
  align-items: center;
  gap: 6px;
}

.version-text {
  font-size: 11px;
  color: var(--text-tertiary);
}

.feedback-link {
  font-size: 11px;
  color: var(--text-primary);
  text-decoration: underline;
  padding: 0;
  border: none;
  background: none;
  cursor: pointer;
}

.github-btn {
  padding: 2px !important;
  color: var(--text-tertiary);
}
.github-btn img {
  width: 14px;
  height: 14px;
}
.github-btn:hover {
  color: var(--text-secondary);
}

.check-update-btn {
  font-size: 11px;
  padding: 3px 10px;
  border: 1px solid var(--border-default);
  border-radius: 5px;
  background: var(--bg-input);
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.2s;
}
.check-update-btn:hover:not(:disabled) {
  background: var(--bg-import-hover);
}
.check-update-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.check-update-btn.update-ready {
  background: #22C55E;
  color: #fff;
  border-color: #22C55E;
}
.check-update-btn.update-ready:hover {
  background: #16A34A;
}
.check-update-btn.has-update {
  background: #3B82F6;
  color: #fff;
  border-color: #3B82F6;
}
.check-update-btn.has-update:hover {
  background: #2563EB;
}

.toggle-group {
  margin-top: 20px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.dev-hint {
  font-size: 11px;
  color: var(--text-secondary);
  opacity: 0.7;
  margin-left: 6px;
  white-space: nowrap;
}

</style>
