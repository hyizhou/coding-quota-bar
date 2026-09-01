<template>
  <div class="view-settings" @focusout="onSettingsFocusOut">
    <header class="header">
      <button class="icon-btn back-btn" :title="$t('settings.backBtn')" @click="$emit('go-back')">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="15 18 9 12 15 6"/>
        </svg>
      </button>
      <h1>{{ $t('settings.title') }}</h1>
    </header>

    <!-- 搜索框：实时过滤 provider 卡片与通用设置项 -->
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

    <div class="settings-body" ref="settingsBodyRef">
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
        <div v-for="info in filteredProviderList" :key="info.key" class="settings-card">
        <div class="provider-header">
          <span class="provider-title">{{ $t(`providers.${info.key}`) }}</span>
          <button
            v-if="info.key !== 'codex'"
            class="add-account-btn"
            :title="$t('settings.addAccount')"
            @click="addAccount(info.key)"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
          </button>
        </div>

        <!-- Codex: 单开关模式（读取本地 auth 文件，不支持多账号） -->
        <template v-if="info.key === 'codex'">
          <label class="toggle-row">
            <input type="checkbox" v-model="info.accounts[0].enabled" />
            <span class="toggle-switch"></span>
            <span class="toggle-label">{{ $t('settings.codexToggleHint') }}</span>
          </label>
        </template>

        <!-- 其他 Provider: 多账号模式 -->
        <template v-else>
          <div v-for="(account, idx) in info.accounts" :key="account.id" class="account-item">
            <div class="account-toggle-row">
              <label class="toggle-row">
                <input type="checkbox" v-model="account.enabled" />
                <span class="toggle-switch"></span>
                <input
                  class="account-label-input"
                  v-model="account.label"
                  :placeholder="$t('settings.accountLabelPlaceholder')"
                />
              </label>
              <!-- 测试连接：调真实 fetchUsage 验证 key；仅启用且 API Key 模式的账户显示 -->
              <button
                v-if="account.enabled && account.authMode !== 'weblogin'"
                class="test-conn-btn"
                :class="{
                  'is-testing': getTestState(info.key, account.id)?.status === 'testing',
                  'is-success': getTestState(info.key, account.id)?.status === 'success',
                  'is-failed': getTestState(info.key, account.id)?.status === 'failed',
                }"
                :disabled="getTestState(info.key, account.id)?.status === 'testing'"
                :title="testTitle(info.key, account.id)"
                @click="testConnection(info, account)"
              >
                <svg v-if="getTestState(info.key, account.id)?.status === 'testing'" class="spin" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                  <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
                </svg>
                <svg v-else-if="getTestState(info.key, account.id)?.status === 'success'" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
                <svg v-else-if="getTestState(info.key, account.id)?.status === 'failed'" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
                <svg v-else width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
                </svg>
                <span v-if="getTestState(info.key, account.id)?.status === 'testing'">{{ $t('settings.testing') }}</span>
                <span v-else-if="getTestState(info.key, account.id)?.status === 'success'">
                  {{ $t('settings.testSuccess') }} · {{ $t('settings.testLatency', { ms: getTestState(info.key, account.id)?.latencyMs }) }}
                </span>
                <span v-else-if="getTestState(info.key, account.id)?.status === 'failed'">
                  {{ $t('settings.testFailed') }}{{ getTestState(info.key, account.id)?.error ? ' · ' + getTestState(info.key, account.id)?.error : '' }}
                </span>
                <span v-else>{{ $t('settings.testConnection') }}</span>
              </button>
            </div>
            <div class="provider-body" v-if="account.enabled">
              <!-- MiMo: 仅网页登录，无 authMode 切换，无 API Key 输入 -->
              <div v-if="info.key === 'mimo'" class="web-login-section">
                <button
                  class="web-login-btn"
                  :class="{ active: account.webTokenStatus === 'active' }"
                  @click="handleMimoWebLogin(account)"
                >
                  {{ account.webTokenStatus === 'active'
                     ? $t('settings.webLoginActive')
                     : account.webTokenStatus === 'expired'
                       ? $t('settings.webTokenExpired')
                       : $t('settings.mimoLoginBtn') }}
                </button>
                <button
                  v-if="account.webTokenStatus === 'active'"
                  class="web-logout-btn"
                  @click="handleMimoWebLogout(account)"
                >
                  {{ $t('settings.webLogoutBtn') }}
                </button>
              </div>

              <!-- DeepSeek 认证模式选择 -->
              <template v-else>
                <div v-if="info.key === 'deepseek'" class="auth-mode-row">
                  <label class="mode-option" :class="{ active: account.authMode !== 'weblogin' }" :title="$t('settings.authModeApikeyHint')">
                    <input type="radio" :value="'apikey'" v-model="account.authMode" />
                    <span>API Key</span>
                  </label>
                  <label class="mode-option" :class="{ active: account.authMode === 'weblogin' }" :title="$t('settings.authModeWebloginHint')">
                    <input type="radio" :value="'weblogin'" v-model="account.authMode" />
                    <span>{{ $t('settings.authModeWeblogin') }}</span>
                  </label>
                </div>

                <!-- API Key 输入（apikey 模式） -->
                <div v-if="account.authMode !== 'weblogin'" class="input-group">
                  <input
                    :type="account.showKey ? 'text' : 'password'"
                    class="form-input"
                    :value="account.apiKeyDirty ? account.apiKey : ''"
                    :placeholder="account.maskedApiKey || 'API Key'"
                    @input="onApiKeyInput(account, $event)"
                  />
                  <button class="icon-btn eye-btn" @click="account.showKey = !account.showKey">
                    <svg v-if="account.showKey" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>
                    </svg>
                    <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
                    </svg>
                  </button>
                  <button class="icon-btn delete-btn" :title="$t('settings.removeAccount')" @click="removeAccount(info.key, idx)">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                    </svg>
                  </button>
                </div>

                <!-- 网页登录按钮（weblogin 模式，仅 DeepSeek） -->
                <div v-if="info.key === 'deepseek' && account.authMode === 'weblogin'" class="web-login-section">
                  <button
                    class="web-login-btn"
                    :class="{ active: account.webTokenStatus === 'active' }"
                    @click="handleWebLogin(account)"
                  >
                    {{ account.webTokenStatus === 'active'
                       ? $t('settings.webLoginActive')
                       : account.webTokenStatus === 'expired'
                         ? $t('settings.webTokenExpired')
                         : $t('settings.webLoginBtn') }}
                  </button>
                  <button
                    v-if="account.webTokenStatus === 'active'"
                    class="web-logout-btn"
                    @click="handleWebLogout(account)"
                  >
                    {{ $t('settings.webLogoutBtn') }}
                  </button>
                </div>
              </template>
            </div>
          </div>

          <div v-if="info.accounts.length === 0" class="no-accounts">
            {{ $t('settings.noAccounts') }}
          </div>
        </template>
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
            <option value="lowest">{{ $t('settings.trayDisplayLowest') }}</option>
            <option value="highest">{{ $t('settings.trayDisplayHighest') }}</option>
            <option
              v-for="opt in accountOptions"
              :key="opt.value"
              :value="opt.value"
            >{{ opt.label }}</option>
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

    <footer class="footer">
      <span class="save-status" :class="{ error: saveError }">{{ saveStatus }}</span>
    </footer>

  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, nextTick, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AppConfig, ProviderTypeConfig, AccountConfig, UpdateStatus } from '../types'
import { useTheme } from '../composables/useTheme'
import { maskApiKey } from '../../../shared/mask'

defineEmits<{ 'go-back': [] }>()
const props = defineProps<{ autoCheckUpdate?: boolean }>()

const { t, locale } = useI18n()
const { preference: themePreference, setTheme } = useTheme()

interface AccountInfo {
  id: string
  label: string
  enabled: boolean
  apiKey: string
  maskedApiKey: string
  showKey: boolean
  budget?: number
  authMode: 'apikey' | 'weblogin'
  webTokenStatus: 'none' | 'active' | 'expired'
  apiKeyDirty: boolean
}

interface ProviderInfo {
  key: string
  label: string
  accounts: AccountInfo[]
}

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

const accountOptions = computed(() => {
  const options: { value: string; label: string }[] = []
  for (const info of providerList.value) {
    const providerName = t(`providers.${info.key}`)
    for (const account of info.accounts) {
      const label = account.label || t('main.defaultAccountLabel', { n: info.accounts.indexOf(account) + 1 })
      options.push({
        value: `${info.key}:${account.id}`,
        label: `${providerName} - ${label}`,
      })
    }
  }
  return options
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
  provider.accounts.push({
    id: generateId(),
    label: '',
    enabled: true,
    apiKey: '',
    maskedApiKey: '',
    showKey: false,
    authMode: (providerKey === 'mimo' || providerKey === 'codex') ? 'weblogin' : 'apikey',
    webTokenStatus: 'none',
    apiKeyDirty: false,
  })
}

function removeAccount(providerKey: string, index: number) {
  const provider = providerList.value.find(p => p.key === providerKey)
  if (!provider) return
  provider.accounts.splice(index, 1)
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

interface TestState {
  status: 'idle' | 'testing' | 'success' | 'failed'
  error?: string
  latencyMs?: number
  sample?: { used: number; total: number; level: string }
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
      showKey: false,
      budget: (account as any).budget ?? undefined,
      authMode: (key === 'mimo' || key === 'codex') ? (account.authMode ?? 'weblogin') : (account.authMode ?? 'apikey'),
      webTokenStatus: key === 'mimo'
        ? ((account as any).mimoLoggedIn ? 'active' : 'none')
        : key === 'codex'
          ? 'none'
          : (account.hasWebToken ? 'active' : 'none'),
      apiKeyDirty: false,
    }))

    // Codex: 确保始终有一个默认账户
    if (key === 'codex' && accounts.length === 0) {
      accounts.push({
        id: generateId(),
        label: 'Codex',
        enabled: false,
        apiKey: '',
        maskedApiKey: '',
        showKey: false,
        authMode: 'weblogin',
        webTokenStatus: 'none',
        apiKeyDirty: false,
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

  // 选中的账户被删除时，回退到最低额度
  stopWatches.push(watch(accountOptions, (opts) => {
    if (trayDisplayRule.value !== 'lowest' && trayDisplayRule.value !== 'highest') {
      if (!opts.some(o => o.value === trayDisplayRule.value)) {
        trayDisplayRule.value = 'lowest'
      }
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
        if (a.apiKeyDirty) {
          update.apiKey = a.apiKey
          pendingKeys.push({ account: a, key: a.apiKey })
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

.settings-body {
  flex: 1;
  overflow-y: auto;
}

.settings-body::-webkit-scrollbar { width: 3px; }
.settings-body::-webkit-scrollbar-thumb { background: var(--scrollbar-thumb); border-radius: 2px; }

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

.provider-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.provider-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-heading);
}

.add-account-btn {
  display: inline-flex;
  align-items: center;
  font-size: 11px;
  padding: 2px 6px;
  border: 1px dashed var(--border-default);
  border-radius: 4px;
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
  opacity: 0;
  transition: all 0.2s ease;
}
.provider-header:hover .add-account-btn,
.add-account-btn:focus-visible {
  opacity: 1;
}
.provider-header .add-account-btn:hover,
.add-account-btn:focus-visible {
  border-color: #3B82F6;
  color: #3B82F6;
}

.account-item {
  border-top: 1px solid var(--border-subtle);
  padding-top: 8px;
  margin-top: 8px;
}

.account-toggle-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.account-toggle-row .toggle-row {
  flex: 1;
  min-width: 0;
}

.account-label-input {
  flex: 1;
  font-size: 12px;
  color: var(--text-secondary);
  background: transparent;
  border: none;
  outline: none;
  padding: 0 4px;
}
.account-label-input::placeholder {
  color: var(--text-tertiary);
}

.test-conn-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  flex-shrink: 0;
  max-width: 45%;
  font-size: 11px;
  padding: 2px 8px;
  border: 1px solid var(--border-default);
  border-radius: 4px;
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
  transition: all 0.15s;
  overflow: hidden;
  white-space: nowrap;
}
.test-conn-btn > span {
  overflow: hidden;
  text-overflow: ellipsis;
}
.test-conn-btn:hover:not(:disabled):not(.is-testing):not(.is-success):not(.is-failed) {
  border-color: #3B82F6;
  color: #3B82F6;
}
.test-conn-btn:disabled {
  cursor: not-allowed;
  opacity: 0.7;
}
.test-conn-btn.is-testing {
  color: var(--text-tertiary);
}
.test-conn-btn.is-success {
  color: #22C55E;
  border-color: #22C55E;
  background: rgba(34, 197, 94, 0.08);
}
.test-conn-btn.is-failed {
  color: #ef4444;
  border-color: #ef4444;
  background: rgba(239, 68, 68, 0.08);
}
.test-conn-btn .spin {
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  to { transform: rotate(360deg); }
}

.provider-body {
  margin-top: 8px;
}

.input-group {
  display: flex;
  gap: 4px;
}

.eye-btn {
  border: 1px solid var(--border-default) !important;
  padding: 4px 6px !important;
}

.delete-btn {
  border: 1px solid var(--border-default) !important;
  padding: 4px 6px !important;
  color: var(--text-tertiary);
}
.delete-btn:hover {
  color: #ef4444;
}

.no-accounts {
  font-size: 11px;
  color: var(--text-tertiary);
  text-align: center;
  padding: 8px 0;
}

.auth-mode-row {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 8px;
}

.mode-option {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--text-tertiary);
  padding: 3px 8px;
  border: 1px solid var(--border-default);
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.15s;
}

.mode-option.active {
  border-color: #3B82F6;
  color: #3B82F6;
}

.mode-option input[type="radio"] {
  margin: 0;
  accent-color: #3B82F6;
}

.web-login-section {
  display: flex;
  gap: 6px;
  align-items: center;
}

.web-login-btn {
  font-size: 11px;
  padding: 4px 12px;
  border: 1px solid var(--border-default);
  border-radius: 4px;
  background: var(--bg-input);
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.15s;
}

.web-login-btn:hover {
  border-color: #3B82F6;
  color: #3B82F6;
}

.web-login-btn.active {
  border-color: #22C55E;
  color: #22C55E;
}

.web-logout-btn {
  font-size: 11px;
  padding: 4px 8px;
  border: 1px solid var(--border-default);
  border-radius: 4px;
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
  transition: all 0.15s;
}

.web-logout-btn:hover {
  color: #ef4444;
  border-color: #ef4444;
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
