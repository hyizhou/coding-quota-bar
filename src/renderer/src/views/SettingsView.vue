<template>
  <div class="view-settings">
    <header class="header">
      <button class="icon-btn back-btn" :title="$t('settings.backBtn')" @click="$emit('go-back')">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="15 18 9 12 15 6"/>
        </svg>
      </button>
      <h1>{{ $t('settings.title') }}</h1>
    </header>

    <div class="settings-body" ref="settingsBodyRef">
      <div class="section-label">{{ $t('settings.providerSection') }}</div>

      <div v-for="info in providerList" :key="info.key" class="settings-card">
        <div class="provider-header">
          <span class="provider-title">{{ $t(`providers.${info.key}`) }}</span>
          <button class="add-account-btn" @click="addAccount(info.key)">
            + {{ $t('settings.addAccount') }}
          </button>
        </div>

        <div v-for="(account, idx) in info.accounts" :key="account.id" class="account-item">
          <label class="toggle-row">
            <input type="checkbox" v-model="account.enabled" />
            <span class="toggle-switch"></span>
            <input
              class="account-label-input"
              v-model="account.label"
              :placeholder="$t('settings.accountLabelPlaceholder')"
            />
          </label>
          <div class="provider-body" v-if="account.enabled">
            <!-- DeepSeek 认证模式选择 -->
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
                v-model="account.apiKey"
                placeholder="API Key"
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
          </div>
        </div>

        <div v-if="info.accounts.length === 0" class="no-accounts">
          {{ $t('settings.noAccounts') }}
        </div>
      </div>

      <div class="section-label">{{ $t('settings.generalSection') }}</div>

      <div class="settings-card">
        <div class="form-group">
          <label class="form-label">{{ $t('settings.refreshInterval') }}</label>
          <select v-model="refreshInterval" class="form-select">
            <option value="60">{{ $t('settings.interval1m') }}</option>
            <option value="120">{{ $t('settings.interval2m') }}</option>
            <option value="300">{{ $t('settings.interval5m') }}</option>
            <option value="600">{{ $t('settings.interval10m') }}</option>
            <option value="1800">{{ $t('settings.interval30m') }}</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">{{ $t('settings.popupTriggerLabel') }}</label>
          <select v-model="popupTrigger" class="form-select">
            <option value="hover">{{ $t('settings.popupTriggerHover') }}</option>
            <option value="click">{{ $t('settings.popupTriggerClick') }}</option>
          </select>
        </div>
        <div class="form-group">
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
        <div class="form-group">
          <label class="form-label">{{ $t('settings.language') }}</label>
          <select v-model="language" class="form-select">
            <option value="zh-CN">中文</option>
            <option value="en-US">English</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">{{ $t('settings.theme') }}</label>
          <select v-model="themePreference" class="form-select">
            <option value="light">{{ $t('settings.themeLight') }}</option>
            <option value="dark">{{ $t('settings.themeDark') }}</option>
            <option value="auto">{{ $t('settings.themeAuto') }}</option>
          </select>
        </div>
        <div class="toggle-group">
          <label class="toggle-row">
            <input type="checkbox" v-model="autoStart" :disabled="!isPackaged" />
            <span class="toggle-switch"></span>
            <span class="toggle-label">{{ $t('settings.autoStart') }}</span>
            <span v-if="!isPackaged" class="dev-hint">{{ $t('settings.devModeHint') }}</span>
          </label>
          <label class="toggle-row" :title="$t('settings.memorySavingModeHint')">
            <input type="checkbox" v-model="memorySavingMode" />
            <span class="toggle-switch"></span>
            <span class="toggle-label">{{ $t('settings.memorySavingMode') }}</span>
          </label>
          <label class="toggle-row" :title="$t('settings.showEstimatedCostHint')">
            <input type="checkbox" v-model="showEstimatedCost" />
            <span class="toggle-switch"></span>
            <span class="toggle-label">{{ $t('settings.showEstimatedCost') }}</span>
          </label>
          <label class="toggle-row" :title="$t('settings.autoCheckUpdateHint')">
            <input type="checkbox" v-model="autoCheckUpdateEnabled" />
            <span class="toggle-switch"></span>
            <span class="toggle-label">{{ $t('settings.autoCheckUpdate') }}</span>
          </label>
        </div>
      </div>

      <div class="version-section">
        <div class="version-left">
          <button class="icon-btn github-btn" title="GitHub" @click="openGitHub">
            <img src="../assets/github.svg" alt="GitHub" />
          </button>
          <button class="feedback-link" @click="openFeedback">{{ $t('settings.feedbackGroup') }}</button>
          <span class="version-text">v{{ appVersion }}</span>
        </div>
        <button
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

defineEmits<{ 'go-back': [] }>()
const props = defineProps<{ autoCheckUpdate?: boolean }>()

const { t, locale } = useI18n()
const { preference: themePreference, setTheme } = useTheme()

interface AccountInfo {
  id: string
  label: string
  enabled: boolean
  apiKey: string
  showKey: boolean
  budget?: number
  authMode: 'apikey' | 'weblogin'
  webTokenStatus: 'none' | 'active' | 'expired'
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
const language = ref('zh-CN')
const popupTrigger = ref<'hover' | 'click'>('hover')
const memorySavingMode = ref(false)
const showEstimatedCost = ref(false)
const trayDisplayRule = ref<string>('lowest')
const autoCheckUpdateEnabled = ref(true)
const saving = ref(false)
const settingsBodyRef = ref<HTMLElement | null>(null)
const saveStatus = ref('')
const saveError = ref(false)
const currentConfig = ref<AppConfig | null>(null)

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
    showKey: false,
    authMode: 'apikey',
    webTokenStatus: 'none',
  })
}

function removeAccount(providerKey: string, index: number) {
  const provider = providerList.value.find(p => p.key === providerKey)
  if (!provider) return
  provider.accounts.splice(index, 1)
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

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    saveConfig()
  }, 500)
}

onMounted(async () => {
  appVersion.value = await window.electronAPI.getAppVersion()
  const config = await window.electronAPI.getConfig()
  if (!config) return
  currentConfig.value = config

  // 从主进程获取可用的 provider 列表
  const availableKeys: string[] = await window.electronAPI.getAvailableProviders()

  providerList.value = availableKeys.map(key => {
    const providerConfig = config.providers[key] as ProviderTypeConfig | undefined
    return {
      key,
      label: t(`providers.${key}`),
      accounts: (providerConfig?.accounts ?? []).map((account: AccountConfig) => ({
        id: account.id,
        label: account.label ?? '',
        enabled: account.enabled ?? false,
        apiKey: account.apiKey ?? '',
        showKey: false,
        budget: (account as any).budget ?? undefined,
        authMode: account.authMode ?? 'apikey',
        webTokenStatus: account.webToken ? 'active' : 'none',
      }))
    }
  })
  refreshInterval.value = String(config.refreshInterval)
  autoStart.value = config.autoStart
  isPackaged.value = (config as any).isPackaged ?? true
  language.value = config.language || locale.value
  popupTrigger.value = config.popupTrigger ?? 'hover'
  memorySavingMode.value = config.memorySavingMode ?? false
  showEstimatedCost.value = config.showEstimatedCost ?? false
  trayDisplayRule.value = config.trayDisplayRule ?? 'lowest'
  autoCheckUpdateEnabled.value = config.autoCheckUpdate ?? true

  // 配置加载完后开始监听变化，自动保存
  watch([providerList, refreshInterval, autoStart, language, popupTrigger, memorySavingMode, showEstimatedCost, trayDisplayRule, autoCheckUpdateEnabled], () => {
    scheduleSave()
  }, { deep: true })

  // 选中的账户被删除时，回退到最低额度
  watch(accountOptions, (opts) => {
    if (trayDisplayRule.value !== 'lowest' && trayDisplayRule.value !== 'highest') {
      if (!opts.some(o => o.value === trayDisplayRule.value)) {
        trayDisplayRule.value = 'lowest'
      }
    }
  })

  // 主题切换由 useTheme 自行持久化，不经过 scheduleSave
  watch(themePreference, (val) => {
    setTheme(val)
  })

  // 恢复主进程的更新状态
  if (config.updateStatus) {
    updateState.value = config.updateStatus
  }

  // 监听主进程推送的更新状态变化
  const offUpdateStatus = window.electronAPI.onUpdateStatusChanged((status) => {
    updateState.value = status
  })

  // 监听来自托盘菜单的检查更新事件（兼容旧路径）
  const onTriggerCheckUpdate = () => {
    settingsBodyRef.value?.scrollTo({ top: settingsBodyRef.value.scrollHeight })
    if (updateState.value.phase === 'idle' || updateState.value.phase === 'noUpdate' || updateState.value.phase === 'error') {
      window.electronAPI.checkForUpdate()
    }
  }
  window.electronAPI.onTriggerCheckUpdate?.(onTriggerCheckUpdate)
  onUnmounted(() => {
    window.electronAPI.offTriggerCheckUpdate?.(onTriggerCheckUpdate)
    offUpdateStatus()
  })

  // 从托盘菜单或更新浮窗进入时，滚到底部；若已有更新信息则不再重复检查
  if (props.autoCheckUpdate) {
    nextTick(() => {
      settingsBodyRef.value?.scrollTo({ top: settingsBodyRef.value.scrollHeight })
      const phase = updateState.value.phase
      if (phase === 'idle' || phase === 'noUpdate' || phase === 'error') {
        window.electronAPI.checkForUpdate()
      }
      window.electronAPI.showPopup()
    })
  }
})

async function saveConfig() {
  if (!currentConfig.value) return
  saving.value = true
  saveStatus.value = t('settings.saving')
  saveError.value = false

  const providers: Record<string, ProviderTypeConfig> = {}
  for (const info of providerList.value) {
    providers[info.key] = {
      accounts: info.accounts.map(a => ({
        id: a.id,
        label: a.label,
        enabled: a.enabled,
        apiKey: a.apiKey,
        ...(a.budget != null ? { budget: a.budget } : {}),
        authMode: a.authMode,
      }))
    }
  }

  try {
    await window.electronAPI.updateConfig({
      providers,
      refreshInterval: parseInt(refreshInterval.value, 10),
      autoStart: autoStart.value,
      popupTrigger: popupTrigger.value,
      memorySavingMode: memorySavingMode.value,
      showEstimatedCost: showEstimatedCost.value,
      language: language.value,
      trayDisplayRule: trayDisplayRule.value,
      autoCheckUpdate: autoCheckUpdateEnabled.value,
    })
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
  window.electronAPI.showFeedback()
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
  font-size: 11px;
  padding: 2px 8px;
  border: 1px dashed var(--border-default);
  border-radius: 4px;
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
  transition: all 0.15s;
}
.add-account-btn:hover {
  border-color: #3B82F6;
  color: #3B82F6;
}

.account-item {
  border-top: 1px solid var(--border-subtle);
  padding-top: 8px;
  margin-top: 8px;
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

.feedback-link {
  font-size: 11px;
  color: var(--text-tertiary);
  background: none;
  border: none;
  cursor: pointer;
  padding: 0;
  text-decoration: underline;
  text-underline-offset: 2px;
}
.feedback-link:hover {
  color: var(--text-secondary);
}
</style>
