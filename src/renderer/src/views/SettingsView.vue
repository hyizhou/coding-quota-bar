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

    <!-- Tier 2: 搜索框 -->
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

    <!-- Tier 1: 未保存改动提示 -->
    <div v-if="pendingChanges" class="unsaved-banner">
      <span class="unsaved-icon">●</span>
      <span class="unsaved-text">{{ $t('settings.unsavedChanges') }}</span>
      <span class="unsaved-actions">
        <button class="unsaved-btn-save" @click="saveConfig">{{ $t('settings.saveNow') }}</button>
      </span>
    </div>

    <div class="settings-body" ref="settingsBodyRef">
      <div class="section-label" :class="{ 'is-collapsed': collapsedSections.has('providers') }" @click="toggleSection('providers')">
        <span class="section-toggle">{{ collapsedSections.has('providers') ? '▶' : '▼' }}</span>
        {{ $t('settings.providerSection') }}
        <span class="section-count">({{ filteredProviderList.length }})</span>
      </div>

      <div v-if="!collapsedSections.has('providers')">
        <div v-if="searchNoMatch" class="no-match">{{ $t('settings.noMatch') }}</div>
        <div v-for="info in filteredProviderList" :key="info.key" class="settings-card">
        <div class="provider-header">
          <span class="provider-title">
            {{ $t(`providers.${info.key}`) }}
            <span
              class="provider-status-badge"
              :class="`status-${getProviderStatus(info).key}`"
              :title="$t(`settings.providerStatus${getProviderStatus(info).key.charAt(0).toUpperCase() + getProviderStatus(info).key.slice(1)}`)"
              :aria-label="$t(`settings.providerStatus${getProviderStatus(info).key.charAt(0).toUpperCase() + getProviderStatus(info).key.slice(1)}`)"
              role="status"
            >
              <span class="status-dot-inline"></span>
              {{ $t(`settings.providerStatus${getProviderStatus(info).key.charAt(0).toUpperCase() + getProviderStatus(info).key.slice(1)}`) }}
            </span>
          </span>
          <button v-if="info.key !== 'codex'" class="add-account-btn" @click="addAccount(info.key)">
            + {{ $t('settings.addAccount') }}
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

                <!-- Tier 1: 测试连接按钮 + 结果 -->
                <div v-if="account.authMode !== 'weblogin'" class="test-connection-row">
                  <button
                    class="test-conn-btn"
                    :class="{
                      'is-testing': testStates[`${info.key}:${account.id}`]?.status === 'testing',
                      'is-success': testStates[`${info.key}:${account.id}`]?.status === 'success',
                      'is-failed':  testStates[`${info.key}:${account.id}`]?.status === 'failed',
                    }"
                    :disabled="testStates[`${info.key}:${account.id}`]?.status === 'testing'"
                    @click="testConnection(info, account)"
                  >
                    <svg v-if="testStates[`${info.key}:${account.id}`]?.status === 'testing'" class="spin" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                      <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
                    </svg>
                    <svg v-else-if="testStates[`${info.key}:${account.id}`]?.status === 'success'" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                      <polyline points="20 6 9 17 4 12"/>
                    </svg>
                    <svg v-else-if="testStates[`${info.key}:${account.id}`]?.status === 'failed'" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                      <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                    <svg v-else width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
                    </svg>
                    <span v-if="testStates[`${info.key}:${account.id}`]?.status === 'testing'">{{ $t('settings.testing') }}</span>
                    <span v-else-if="testStates[`${info.key}:${account.id}`]?.status === 'success'">
                      {{ $t('settings.testSuccess') }} · {{ $t('settings.testLatency', { ms: testStates[`${info.key}:${account.id}`]?.latencyMs }) }}
                    </span>
                    <span v-else-if="testStates[`${info.key}:${account.id}`]?.status === 'failed'">
                      {{ $t('settings.testFailed') }}{{ testStates[`${info.key}:${account.id}`]?.error ? ' · ' + testStates[`${info.key}:${account.id}`]?.error : '' }}
                    </span>
                    <span v-else>{{ $t('settings.testConnection') }}</span>
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

      <div class="section-label" :class="{ 'is-collapsed': collapsedSections.has('general') }" @click="toggleSection('general')">
        <span class="section-toggle">{{ collapsedSections.has('general') ? '▶' : '▼' }}</span>
        {{ $t('settings.generalSection') }}
      </div>

      <div v-if="!collapsedSections.has('general')">

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
          <label class="form-label">{{ $t('settings.colorCustomization') }}</label>
          <div class="color-config-v2">
            <!-- 阈值带：拖动两个手柄设绿/黄分界、黄/红分界 -->
            <div class="threshold-track">
              <div class="threshold-segments">
                <div class="seg seg-green" :style="{ width: yellowThreshold + '%' }"></div>
                <div class="seg seg-yellow" :style="{ width: (greenThreshold - yellowThreshold) + '%' }"></div>
                <div class="seg seg-red" :style="{ width: (100 - greenThreshold) + '%' }"></div>
              </div>
              <input
                type="range" min="0" max="100" step="1"
                v-model.lazy.number="greenThreshold"
                class="threshold-handle threshold-handle-green"
                :title="`绿/黄分界 ${greenThreshold}%`"
                role="slider"
                :aria-valuemin="0"
                :aria-valuemax="100"
                :aria-valuenow="greenThreshold"
                :aria-label="`绿/黄分界阈值 ${greenThreshold}%`"
                @change="scheduleSave"
              />
              <input
                type="range" min="0" max="100" step="1"
                v-model.lazy.number="yellowThreshold"
                class="threshold-handle threshold-handle-yellow"
                :title="`黄/红分界 ${yellowThreshold}%`"
                role="slider"
                :aria-valuemin="0"
                :aria-valuemax="100"
                :aria-valuenow="yellowThreshold"
                :aria-label="`黄/红分界阈值 ${yellowThreshold}%`"
                @change="scheduleSave"
              />
            </div>
            <div class="threshold-labels">
              <span>0%</span>
              <span :style="{ left: yellowThreshold + '%' }">{{ yellowThreshold }}%</span>
              <span :style="{ left: greenThreshold + '%' }">{{ greenThreshold }}%</span>
              <span>100%</span>
            </div>

            <!-- 实时预览：模拟 QuotaCard 三个状态 -->
            <div class="color-preview-cards">
              <div class="preview-card">
                <div class="preview-percent" :style="{ color: customGreen }">87%</div>
                <div class="preview-bar"><div class="preview-fill" :style="{ width: '87%', background: customGreen }"></div></div>
                <div class="preview-label">{{ $t('settings.colorGreen') }}</div>
              </div>
              <div class="preview-card">
                <div class="preview-percent" :style="{ color: customYellow }">42%</div>
                <div class="preview-bar"><div class="preview-fill" :style="{ width: '42%', background: customYellow }"></div></div>
                <div class="preview-label">{{ $t('settings.colorYellow') }}</div>
              </div>
              <div class="preview-card">
                <div class="preview-percent" :style="{ color: customRed }">5%</div>
                <div class="preview-bar"><div class="preview-fill" :style="{ width: '5%', background: customRed }"></div></div>
                <div class="preview-label">{{ $t('settings.colorRed') }}</div>
              </div>
            </div>

            <!-- 4 个颜色单独配 -->
            <div class="color-swatches">
              <label class="swatch-row">
                <span class="swatch-label">{{ $t('settings.colorGreen') }}</span>
                <input type="color" v-model="customGreen" class="color-picker" />
              </label>
              <label class="swatch-row">
                <span class="swatch-label">{{ $t('settings.colorYellow') }}</span>
                <input type="color" v-model="customYellow" class="color-picker" />
              </label>
              <label class="swatch-row">
                <span class="swatch-label">{{ $t('settings.colorRed') }}</span>
                <input type="color" v-model="customRed" class="color-picker" />
              </label>
              <label class="swatch-row">
                <span class="swatch-label">{{ $t('settings.colorGray') }}</span>
                <input type="color" v-model="customGray" class="color-picker" />
              </label>
            </div>
          </div>
          <button class="reset-colors-btn" @click="resetColors">{{ $t('settings.resetColors') }}</button>
        </div>

        <!-- Tier 2: 导入/导出配置 -->
        <ImportExportSection
          :export-mode="exportMode"
          :status="importExportStatus"
          :error="importExportError"
          :confirm-pending="importConfirmPending"
          @update:export-mode="exportMode = $event"
          @export="exportConfig"
          @import="importConfig"
          @cancel-import="cancelImport"
          @confirm-import="confirmImport"
        />

        <!-- Tier 3: 诊断面板 -->
        <DiagnosticsSection
          :config-path="configPath"
          :reloading="reloadingConfig"
          :pinging="pingingAll"
          :ping-result="pingResult"
          :log-tail="logTail"
          @open-folder="openConfigFolder"
          @reload="reloadConfig"
          @ping-all="pingAll"
          @view-log="loadRendererLog"
        />
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
          <label class="toggle-row" :title="$t('settings.rememberPopupPositionHint')">
            <input type="checkbox" v-model="rememberPopupPosition" />
            <span class="toggle-switch"></span>
            <span class="toggle-label">{{ $t('settings.rememberPopupPosition') }}</span>
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
import ImportExportSection from '../components/settings/ImportExportSection.vue'
import DiagnosticsSection from '../components/settings/DiagnosticsSection.vue'

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
const language = ref('zh-CN')
const popupTrigger = ref<'hover' | 'click'>('hover')
const memorySavingMode = ref(false)
const rememberPopupPosition = ref(false)
const showEstimatedCost = ref(false)
const trayDisplayRule = ref<string>('lowest')
const autoCheckUpdateEnabled = ref(true)
const customGreen = ref('#4ADE80')
const customYellow = ref('#FACC15')
const customRed = ref('#F87171')
const customGray = ref('#94A3B8')
const greenThreshold = ref(50)
const yellowThreshold = ref(20)
const saving = ref(false)
const settingsBodyRef = ref<HTMLElement | null>(null)
const saveStatus = ref('')
const saveError = ref(false)
const currentConfig = ref<AppConfig | null>(null)

/**
 * === Tier 1: 未保存改动追踪 ===
 * pendingChanges: 有改动但还没保存（debounce 期间 + 正在保存期间）
 * 测试连接状态: per-accountId
 */
const pendingChanges = ref(false)
const testStates = ref<Record<string, { status: 'idle' | 'testing' | 'success' | 'failed'; error?: string; latencyMs?: number; sample?: { used: number; total: number; level: string } }>>({})

/**
 * === Tier 2: 搜索 + section 折叠 ===
 * - searchQuery: 用户输入的关键字（实时过滤）
 * - collapsedSections: 哪些 section 被折叠（key = section id）
 * - filteredProviderList: 搜索后剩下的 provider 列表（不修改原数据）
 */
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
const searchNoMatch = computed(() => {
  const q = searchQuery.value.trim()
  if (!q) return false
  // 检查整个 general section 是否有匹配（按 form-label 文本模糊匹配）
  if (filteredProviderList.value.length > 0) return false
  // 简单启发：搜索关键字长度 >= 2 且 general section 至少有一个匹配的 form-label
  const labels = [
    t('settings.refreshInterval'),
    t('settings.popupTriggerLabel'),
    t('settings.trayDisplayRule'),
    t('settings.colorCustomization'),
    t('settings.language'),
    t('settings.theme'),
    t('settings.autoStart'),
    t('settings.memorySavingMode'),
    t('settings.rememberPopupPosition'),
    t('settings.showEstimatedCost'),
    t('settings.autoCheckUpdate'),
  ]
  return !labels.some(l => l.toLowerCase().includes(q.toLowerCase()))
})

/** 监听未保存状态：任何改动后 500ms 内显示"有未保存的更改" */
watch([providerList, refreshInterval, autoStart, language, popupTrigger, memorySavingMode, rememberPopupPosition, showEstimatedCost, trayDisplayRule, autoCheckUpdateEnabled, customGreen, customYellow, customRed, customGray, greenThreshold, yellowThreshold], () => {
  pendingChanges.value = true
  scheduleSave()
}, { deep: true })

/** 保存成功后清除 pending 状态 */
function clearPending() {
  pendingChanges.value = false
}

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
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    saveConfig()
  }, 500)
}

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
  const config = await window.electronAPI.getConfig()
  if (!config) return
  currentConfig.value = config

  // 从主进程获取可用的 provider 列表
  const availableKeys: string[] = await window.electronAPI.getAvailableProviders()

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
      budget: account.budget ?? undefined,
      authMode: (key === 'mimo' || key === 'codex') ? (account.authMode ?? 'weblogin') : (account.authMode ?? 'apikey'),
      webTokenStatus: key === 'mimo'
        ? ((account as { mimoLoggedIn?: boolean }).mimoLoggedIn ? 'active' : 'none')
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
  isPackaged.value = (config as { isPackaged?: boolean }).isPackaged ?? true
  language.value = config.language || locale.value
  popupTrigger.value = config.popupTrigger ?? 'hover'
  memorySavingMode.value = config.memorySavingMode ?? false
  rememberPopupPosition.value = config.rememberPopupPosition ?? false
  showEstimatedCost.value = config.showEstimatedCost ?? false
  trayDisplayRule.value = config.trayDisplayRule ?? 'lowest'
  autoCheckUpdateEnabled.value = config.autoCheckUpdate ?? true
  const thresholds = config.display?.colorThresholds
  if (thresholds) {
    greenThreshold.value = thresholds.green ?? 50
    yellowThreshold.value = thresholds.yellow ?? 20
    if (thresholds.colors) {
      customGreen.value = thresholds.colors.green ?? '#4ADE80'
      customYellow.value = thresholds.colors.yellow ?? '#FACC15'
      customRed.value = thresholds.colors.red ?? '#F87171'
      customGray.value = thresholds.colors.gray ?? '#94A3B8'
    }
  }

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

  const providers: Record<string, { accounts: Partial<AccountConfig>[] }> = {}
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
          a.apiKeyDirty = false
        }
        return update
      })
    }
  }

  try {
    clampThresholds()
    normalizeColors()
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
      display: {
        colorThresholds: {
          green: greenThreshold.value,
          yellow: yellowThreshold.value,
          colors: {
            green: customGreen.value,
            yellow: customYellow.value,
            red: customRed.value,
            gray: customGray.value,
          },
        },
      },
    })
    locale.value = language.value
    saveStatus.value = t('settings.saved')
    clearPending()
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

function resetColors() {
  customGreen.value = '#4ADE80'
  customYellow.value = '#FACC15'
  customRed.value = '#F87171'
  customGray.value = '#94A3B8'
  greenThreshold.value = 50
  yellowThreshold.value = 20
}

function isValidHex(v: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(v)
}

function clampThresholds() {
  if (typeof greenThreshold.value !== 'number' || isNaN(greenThreshold.value)) greenThreshold.value = 50
  if (typeof yellowThreshold.value !== 'number' || isNaN(yellowThreshold.value)) yellowThreshold.value = 20
  greenThreshold.value = Math.max(0, Math.min(100, Math.round(greenThreshold.value)))
  yellowThreshold.value = Math.max(0, Math.min(100, Math.round(yellowThreshold.value)))
  if (greenThreshold.value < yellowThreshold.value) {
    const tmp = greenThreshold.value
    greenThreshold.value = yellowThreshold.value
    yellowThreshold.value = tmp
  }
}

function normalizeColors() {
  if (!isValidHex(customGreen.value)) customGreen.value = '#4ADE80'
  if (!isValidHex(customYellow.value)) customYellow.value = '#FACC15'
  if (!isValidHex(customRed.value)) customRed.value = '#F87171'
  if (!isValidHex(customGray.value)) customGray.value = '#94A3B8'
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

/**
 * === Tier 1: 测试连接 ===
 * 用当前填的 key（如果 dirty）或已保存的 key 调一次 fetchUsage
 */
// 5s 后自动清除成功状态的 timer handle（按 key 索引）
// 解决：连续点击同一 key 时取消上一次的延迟清除，避免状态错乱
const testAutoClearTimers = new Map<string, ReturnType<typeof setTimeout>>()
function clearTestAutoClearTimer(key: string) {
  const t = testAutoClearTimers.get(key)
  if (t) {
    clearTimeout(t)
    testAutoClearTimers.delete(key)
  }
}

async function testConnection(info: ProviderInfo, account: AccountInfo) {
  const key = `${info.key}:${account.id}`
  // 取消该 key 上一次的"5s 后自动清除"timer，避免与新测试状态冲突
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
    // 如果用户刚输了新 key，用新 key（否则用已保存的）
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
  // 5 秒后自动清除成功状态
  if (testStates.value[key].status === 'success') {
    const handle = setTimeout(() => {
      if (testStates.value[key]?.status === 'success') testStates.value[key] = { status: 'idle' }
      testAutoClearTimers.delete(key)
    }, 5000)
    testAutoClearTimers.set(key, handle)
  }
}

/**
 * === Tier 1: Provider 卡片状态徽标 ===
 * 综合所有账号状态：all-ok / some-expired / all-disabled / no-account
 */
function getProviderStatus(info: ProviderInfo): { key: 'allOk' | 'someExpired' | 'allDisabled' | 'noAccount'; count: { ok: number; expired: number; disabled: number } } {
  const accounts = info.accounts
  if (accounts.length === 0) return { key: 'noAccount', count: { ok: 0, expired: 0, disabled: 0 } }
  let ok = 0, expired = 0, disabled = 0
  for (const a of accounts) {
    if (!a.enabled) { disabled++; continue }
    if (a.webTokenStatus === 'expired') { expired++; continue }
    ok++
  }
  if (ok === accounts.length) return { key: 'allOk', count: { ok, expired, disabled } }
  if (expired > 0) return { key: 'someExpired', count: { ok, expired, disabled } }
  return { key: 'allDisabled', count: { ok, expired, disabled } }
}

/**
 * === Tier 1: 离开页面警告 ===
 * 关闭设置面板/卸载组件时，如果有未保存改动，弹原生确认
 */
function handleBeforeUnload(e: BeforeUnloadEvent) {
  if (pendingChanges.value) {
    e.preventDefault()
    e.returnValue = t('settings.unsavedWarningBody')
    return e.returnValue
  }
}
onMounted(() => {
  window.addEventListener('beforeunload', handleBeforeUnload)
})
onUnmounted(() => {
  window.removeEventListener('beforeunload', handleBeforeUnload)
  // 清理所有 test connection 延迟清除 timer，避免组件销毁后还在跑
  for (const handle of testAutoClearTimers.values()) clearTimeout(handle)
  testAutoClearTimers.clear()
})

/**
 * === Tier 2: 导入/导出配置 ===
 * 导出：弹原生保存对话框 → 写文件
 * 导入：弹原生打开对话框 → 解析 → 弹确认卡（防误覆盖）→ 确认后写入
 */
const exportMode = ref<'sanitized' | 'full'>('sanitized')
const importExportStatus = ref('')
const importExportError = ref(false)
const importConfirmPending = ref<{ config: any; isSanitized: boolean } | null>(null)

async function exportConfig() {
  importExportError.value = false
  importExportStatus.value = ''
  const sanitize = exportMode.value === 'sanitized'
  const result = await window.electronAPI.exportConfig({ sanitize })
  if (result.ok) {
    importExportStatus.value = t('settings.exportSuccess', { path: result.path })
  } else if (result.error === '已取消') {
    // 用户取消，no-op
  } else {
    importExportError.value = true
    importExportStatus.value = t('settings.exportFailed', { error: result.error ?? '' })
  }
}

async function importConfig() {
  importExportError.value = false
  importExportStatus.value = ''
  const result = await window.electronAPI.importConfig()
  if (result.canceled) return
  if (!result.ok) {
    importExportError.value = true
    importExportStatus.value = result.error ?? '导入失败'
    return
  }
  // 弹确认卡
  importConfirmPending.value = {
    config: result.config,
    isSanitized: result.isSanitized ?? false,
  }
}

function cancelImport() {
  importConfirmPending.value = null
}

async function confirmImport() {
  if (!importConfirmPending.value) return
  const data = importConfirmPending.value.config
  // 去掉 _exportMeta
  if (data._exportMeta) delete data._exportMeta
  const result = await window.electronAPI.confirmImportConfig(data)
  if (result.ok) {
    importConfirmPending.value = null
    importExportStatus.value = t('settings.importSuccess')
    // 重新加载配置让 UI 同步
    const fresh = await window.electronAPI.getConfig()
    if (fresh) {
      currentConfig.value = fresh
      // 简单 reload：刷新所有 ref
      //（实际项目里可以做得更精细，这里粗暴 reload）
      location.reload()
    }
  } else {
    importExportError.value = true
    importExportStatus.value = result.error ?? '导入失败'
  }
}

/**
 * === Tier 3: 诊断 ===
 */
const configPath = ref('')
const reloadingConfig = ref(false)
const pingingAll = ref(false)
const pingResult = ref<{ ok: number; failed: number; total: number } | null>(null)
const logTail = ref<string[]>([])

async function loadConfigPath() {
  configPath.value = await window.electronAPI.getConfigPath()
}
onMounted(() => { loadConfigPath() })

async function openConfigFolder() {
  await window.electronAPI.openConfigFolder()
}

async function loadRendererLog() {
  // 优先用 openRendererLog（系统默认编辑器打开，跨平台更友好）
  await window.electronAPI.openRendererLog()
  // 同时拉最近 200 行内嵌显示
  const result = await window.electronAPI.getRendererLog()
  logTail.value = result.tail
}

async function reloadConfig() {
  reloadingConfig.value = true
  try {
    await window.electronAPI.reloadConfig()
    location.reload()  // 简单粗暴刷新
  } finally {
    reloadingConfig.value = false
  }
}

async function pingAll() {
  pingingAll.value = true
  pingResult.value = null
  // 收集所有启用的账号
  const tasks: Array<Promise<boolean>> = []
  for (const info of providerList.value) {
    for (const account of info.accounts) {
      if (!account.enabled) continue
      // 跳过 mimo/codex（weblogin，不直接测）
      if (account.authMode === 'weblogin') continue
      tasks.push(
        window.electronAPI.testProviderConnection({
          providerKey: info.key,
          accountId: account.id,
        }).then(r => r.ok).catch(() => false)
      )
    }
  }
  const results = await Promise.all(tasks)
  const ok = results.filter(Boolean).length
  pingResult.value = { ok, failed: results.length - ok, total: results.length }
  pingingAll.value = false
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

/* === Tier 2: 搜索 + section 折叠 === */
.settings-search {
  position: relative;
  margin: 0 10px 8px;
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
  margin: 8px 0 4px;
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
  color: var(--cqb-red);
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
  border-color: var(--cqb-green);
  color: var(--cqb-green);
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
  color: var(--cqb-red);
  border-color: var(--cqb-red);
}

.save-status { font-size: 11px; color: #4CAF50; }
.save-status.error { color: #F44336; }

/* === Tier 2: 颜色配置 v2（滑块 + 实时预览） === */
.color-config-v2 {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 6px;
}
.threshold-track {
  position: relative;
  height: 22px;
  border-radius: 4px;
  overflow: visible;
  margin: 10px 0 4px;
}
.threshold-segments {
  position: absolute;
  inset: 4px 0;
  display: flex;
  border-radius: 3px;
  overflow: hidden;
  pointer-events: none;
}
.seg { transition: width 0.15s; }
.seg-green  { background: var(--cqb-green); }
.seg-yellow { background: var(--cqb-yellow); }
.seg-red    { background: var(--cqb-red); }
.threshold-handle {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 22px;
  background: transparent;
  -webkit-appearance: none;
  appearance: none;
  pointer-events: none;
}
.threshold-handle::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 14px;
  height: 22px;
  background: #fff;
  border: 2px solid var(--text-tertiary);
  border-radius: 3px;
  cursor: grab;
  pointer-events: auto;
  box-shadow: 0 1px 4px rgba(0,0,0,0.3);
}
.threshold-handle::-webkit-slider-thumb:active { cursor: grabbing; }
.threshold-handle::-moz-range-thumb {
  width: 14px;
  height: 22px;
  background: #fff;
  border: 2px solid var(--text-tertiary);
  border-radius: 3px;
  cursor: grab;
  pointer-events: auto;
}
.threshold-handle-yellow { z-index: 2; }
.threshold-handle-green  { z-index: 1; }
.threshold-labels {
  display: flex;
  justify-content: space-between;
  position: relative;
  font-size: 10px;
  color: var(--text-tertiary);
  height: 14px;
  margin-top: 2px;
}
.threshold-labels span { position: absolute; transform: translateX(-50%); }
.threshold-labels span:first-child { position: relative; transform: none; }
.threshold-labels span:last-child  { position: relative; transform: none; }
.color-preview-cards {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
  margin: 4px 0;
}
.preview-card {
  background: var(--bg-input);
  border: 1px solid var(--border-subtle);
  border-radius: 5px;
  padding: 6px 8px;
}
.preview-percent {
  font-size: 14px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  text-align: center;
  transition: color 0.15s;
}
.preview-bar {
  height: 4px;
  background: var(--border-subtle);
  border-radius: 2px;
  margin: 4px 0;
  overflow: hidden;
}
.preview-fill {
  height: 100%;
  border-radius: 2px;
  transition: width 0.2s, background 0.2s;
}
.preview-label {
  font-size: 10px;
  color: var(--text-tertiary);
  text-align: center;
}
.color-swatches {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 4px 12px;
  margin-top: 4px;
}
.swatch-row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--text-secondary);
}
.swatch-label { flex: 1; }

.color-config {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 6px;
}
.color-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}
.color-label {
  flex: 0 0 60px;
  color: var(--text-secondary);
}
.color-threshold-hint {
  flex: 1;
  color: var(--text-tertiary);
  font-size: 11px;
}
.color-number {
  width: 50px;
  padding: 3px 6px;
  border: 1px solid var(--border-base);
  border-radius: 4px;
  background: var(--bg-card);
  color: var(--text-heading);
  font-size: 12px;
  text-align: center;
}
.color-unit {
  color: var(--text-tertiary);
  font-size: 11px;
  margin-right: auto;
}
.color-picker {
  width: 32px;
  height: 24px;
  padding: 0;
  border: 1px solid var(--border-base);
  border-radius: 4px;
  background: none;
  cursor: pointer;
}
.color-picker::-webkit-color-swatch-wrapper { padding: 2px; }
.color-picker::-webkit-color-swatch { border: none; border-radius: 3px; }
.color-preview {
  width: 32px;
  height: 24px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(0, 0, 0, 0.8);
  font-size: 10px;
  font-weight: 700;
  border: 1px solid rgba(0, 0, 0, 0.2);
}
.reset-colors-btn {
  margin-top: 4px;
  padding: 4px 10px;
  background: transparent;
  border: 1px solid var(--border-base);
  border-radius: 4px;
  color: var(--text-secondary);
  font-size: 11px;
  cursor: pointer;
  transition: all 0.15s;
}
.reset-colors-btn:hover {
  border-color: #3B82F6;
  color: #3B82F6;
}

/* === Tier 2: 导入/导出 === */
.import-export-row {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.io-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  padding: 4px 10px;
  border: 1px solid var(--border-default);
  border-radius: 4px;
  background: var(--bg-input);
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.15s;
}
.io-btn:hover {
  background: var(--bg-input-hover);
  color: var(--text-primary);
  border-color: var(--text-tertiary);
}
.io-mode-select {
  font-size: 10px;
  padding: 2px 6px;
  border: 1px solid var(--border-default);
  border-radius: 3px;
  background: var(--bg-input);
  color: var(--text-secondary);
  outline: none;
  cursor: pointer;
}
.import-confirm {
  margin-top: 8px;
  padding: 8px 10px;
  background: rgba(250, 204, 21, 0.08);
  border: 1px solid rgba(250, 204, 21, 0.35);
  border-radius: 5px;
  font-size: 11px;
}
.import-confirm-text strong { display: block; margin-bottom: 4px; color: var(--cqb-yellow-dark); }
.import-confirm-text p { margin: 2px 0; color: var(--text-secondary); }
.import-confirm-body { color: var(--text-tertiary); font-size: 10px; line-height: 1.4; }
.import-confirm-actions {
  display: flex;
  gap: 6px;
  margin-top: 8px;
  justify-content: flex-end;
}
.io-btn-secondary {
  font-size: 11px;
  padding: 3px 10px;
  border: 1px solid var(--border-default);
  border-radius: 3px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
}
.io-btn-secondary:hover { background: var(--bg-input); }
.io-btn-primary {
  font-size: 11px;
  padding: 3px 12px;
  border: 1px solid var(--cqb-green);
  border-radius: 3px;
  background: var(--cqb-green);
  color: #1a1a1a;
  font-weight: 600;
  cursor: pointer;
}
.io-btn-primary:hover { background: var(--cqb-green-light); }
.import-export-status {
  margin-top: 6px;
  font-size: 10px;
  color: var(--cqb-green);
}
.import-export-status.error { color: var(--cqb-red-dark); }

/* === Tier 3: 诊断 === */
.diag-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
  flex-wrap: wrap;
}
.diag-label {
  font-size: 11px;
  color: var(--text-tertiary);
  flex: 0 0 auto;
}
.diag-path {
  flex: 1;
  font-size: 10px;
  font-family: ui-monospace, monospace;
  color: var(--text-secondary);
  background: var(--bg-input);
  border: 1px solid var(--border-subtle);
  border-radius: 3px;
  padding: 2px 6px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}
.diag-btn {
  font-size: 11px;
  padding: 3px 9px;
  border: 1px solid var(--border-default);
  border-radius: 4px;
  background: var(--bg-input);
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.15s;
}
.diag-btn:hover:not(:disabled) {
  background: var(--bg-input-hover);
  border-color: var(--text-tertiary);
  color: var(--text-primary);
}
.diag-btn:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}
.diag-ping-result {
  font-size: 11px;
  font-weight: 500;
  padding: 2px 8px;
  border-radius: 9px;
}
.diag-ping-result.ok      { background: rgba(74, 222, 128, 0.15); color: var(--cqb-green); }
.diag-ping-result.partial { background: rgba(250, 204, 21, 0.15); color: var(--cqb-yellow-dark); }

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
  background: var(--cqb-green);
  color: #fff;
  border-color: var(--cqb-green);
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

/* === Tier 1: Provider 状态徽标 === */
.provider-status-badge {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 10px;
  font-weight: 500;
  padding: 1px 6px;
  border-radius: 9px;
  margin-left: 6px;
  vertical-align: middle;
  transition: all 0.2s;
}
.status-dot-inline {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}
.provider-status-badge.status-allOk {
  background: rgba(74, 222, 128, 0.15);
  color: var(--cqb-green);
}
.provider-status-badge.status-allOk .status-dot-inline {
  background: var(--cqb-green);
}
.provider-status-badge.status-someExpired {
  background: rgba(250, 204, 21, 0.18);
  color: var(--cqb-yellow-dark);
}
.provider-status-badge.status-someExpired .status-dot-inline {
  background: var(--cqb-yellow);
  animation: dot-pulse 2s ease-in-out infinite;
}
.provider-status-badge.status-allDisabled {
  background: rgba(148, 163, 184, 0.18);
  color: var(--cqb-gray);
}
.provider-status-badge.status-allDisabled .status-dot-inline {
  background: var(--cqb-gray);
}
.provider-status-badge.status-noAccount {
  background: rgba(148, 163, 184, 0.12);
  color: var(--cqb-gray);
  opacity: 0.7;
}
.provider-status-badge.status-noAccount .status-dot-inline {
  background: var(--cqb-gray);
}

@keyframes dot-pulse {
  0%, 100% { opacity: 1; }
  50%      { opacity: 0.5; }
}

/* === Tier 1: 测试连接按钮 === */
.test-connection-row {
  margin-top: 6px;
}
.test-conn-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  padding: 3px 9px;
  border: 1px solid var(--border-default);
  border-radius: 4px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.2s;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.test-conn-btn:hover:not(:disabled) {
  background: var(--bg-input);
  border-color: var(--text-tertiary);
  color: var(--text-primary);
}
.test-conn-btn:disabled {
  cursor: not-allowed;
  opacity: 0.7;
}
.test-conn-btn.is-testing {
  color: var(--text-tertiary);
}
.test-conn-btn.is-success {
  color: var(--cqb-green);
  border-color: var(--cqb-green);
  background: rgba(74, 222, 128, 0.08);
}
.test-conn-btn.is-failed {
  color: var(--cqb-red-dark);
  border-color: var(--cqb-red);
  background: rgba(248, 113, 113, 0.08);
}
.test-conn-btn .spin {
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  to { transform: rotate(360deg); }
}

/* === Tier 1: 未保存提示横幅 === */
.unsaved-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  margin: 0 10px 6px;
  background: rgba(250, 204, 21, 0.15);
  border: 1px solid rgba(250, 204, 21, 0.4);
  border-radius: 6px;
  font-size: 11px;
  color: var(--cqb-yellow-dark);
}
.unsaved-icon {
  color: var(--cqb-yellow);
  font-size: 10px;
}
.unsaved-text {
  flex: 1;
  font-weight: 600;
}
.unsaved-actions {
  display: flex;
  gap: 6px;
}
.unsaved-btn-save {
  font-size: 10px;
  padding: 2px 10px;
  border: 1px solid var(--cqb-yellow);
  border-radius: 3px;
  background: var(--cqb-yellow);
  color: #1a1a1a;
  cursor: pointer;
  font-weight: 600;
  transition: all 0.15s;
}
.unsaved-btn-save:hover {
  background: var(--cqb-yellow-light);
  border-color: var(--cqb-yellow-light);
}
</style>
