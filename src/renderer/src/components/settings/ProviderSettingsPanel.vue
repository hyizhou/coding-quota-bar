<!--
  服务商配置详情页：单家服务商的账户卡片列表与认证设置（账户增删、API Key、网页登录、站点/来源切换、测试连接）。
  只负责渲染：直接修改 info（父级的响应式对象）的嵌套字段即可触发父级的自动保存，
  其余操作经 actions 回调到 SettingsView。
-->
<template>
  <div class="provider-panel">
    <!-- Codex: 单卡片模式（读取本地 auth 文件，不支持多账号） -->
    <div v-if="info.key === 'codex'" class="account-card">
      <div class="account-head">
        <label class="toggle-row">
          <input type="checkbox" v-model="info.accounts[0].enabled" />
          <span class="toggle-switch"></span>
        </label>
        <span class="account-desc">{{ $t('settings.codexToggleHint') }}</span>
      </div>
    </div>

    <!-- 其他 Provider: 多账号模式 -->
    <template v-else>
      <div v-for="account in info.accounts" :key="account.id" class="account-card">
        <div class="account-head">
          <label class="toggle-row">
            <input type="checkbox" v-model="account.enabled" />
            <span class="toggle-switch"></span>
          </label>
          <input
            class="account-name"
            v-model="account.label"
            :placeholder="$t('settings.accountLabelPlaceholder')"
          />
          <button
            class="icon-btn account-delete"
            type="button"
            :title="$t('settings.removeAccount')"
            @click="actions.removeAccount(info.key, account.id)"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            </svg>
          </button>
        </div>

        <div v-if="account.enabled" class="account-body">
          <!-- 认证方式：DeepSeek（API Key / 网页登录），Qoder、阶跃（网页登录 / 手动粘贴） -->
          <div v-if="hasAuthSeg" class="setting-row">
            <span class="setting-label">{{ $t('settings.authMethodLabel') }}</span>
            <div class="seg">
              <label v-if="isDeepseek" class="seg-option" :title="$t('settings.authModeApikeyHint')">
                <input type="radio" value="apikey" :name="`auth-${account.id}`" v-model="account.authMode" />
                <span>API Key</span>
              </label>
              <label v-else class="seg-option">
                <input
                  type="radio"
                  value="session"
                  :name="`auth-${account.id}`"
                  :checked="!isManual(account)"
                  @change="setSource(account, 'session')"
                />
                <span>{{ $t(sourceSessionKey) }}</span>
              </label>
              <label v-if="isDeepseek" class="seg-option" :title="$t('settings.authModeWebloginHint')">
                <input type="radio" value="weblogin" :name="`auth-${account.id}`" v-model="account.authMode" />
                <span>{{ $t('settings.authModeWeblogin') }}</span>
              </label>
              <label v-else class="seg-option">
                <input
                  type="radio"
                  value="manual"
                  :name="`auth-${account.id}`"
                  :checked="isManual(account)"
                  @change="setSource(account, 'manual')"
                />
                <span>{{ $t(sourceManualKey) }}</span>
              </label>
            </div>
          </div>

          <!-- 站点：国内站在左、国际站在右；账号互不相通，登录地址与数据接口按此切换 -->
          <div v-if="hasSiteSeg(account)" class="setting-row">
            <span class="setting-label">{{ $t('settings.siteLabel') }}</span>
            <div class="seg">
              <label class="seg-option">
                <input
                  type="radio"
                  value="cn"
                  :name="`site-${account.id}`"
                  :checked="siteModel(account) === 'cn'"
                  @change="setSite(account, 'cn')"
                />
                <span>{{ $t('settings.siteChina') }}</span>
              </label>
              <label class="seg-option">
                <input
                  type="radio"
                  value="global"
                  :name="`site-${account.id}`"
                  :checked="siteModel(account) === 'global'"
                  @change="setSite(account, 'global')"
                />
                <span>{{ $t('settings.siteInternational') }}</span>
              </label>
            </div>
          </div>

          <!-- Qoder / 阶跃手动模式：粘贴捕获内容 -->
          <template v-if="isManual(account)">
            <textarea
              v-if="isQoder"
              class="form-input capture-input"
              :placeholder="$t('settings.qoderManualPlaceholder')"
              v-model="account.qoderManualCapture"
              @input="actions.onQoderCaptureInput(account)"
              @blur="actions.validateQoderCapture(account)"
            ></textarea>
            <textarea
              v-else
              class="form-input capture-input"
              :placeholder="$t('settings.stepfunManualPlaceholder')"
              v-model="account.stepfunManualToken"
              @input="actions.onStepfunTokenInput(account)"
            ></textarea>
            <div
              v-if="isQoder && account.qoderParse"
              class="hint"
              :class="account.qoderParse.ok ? 'is-ok' : 'is-error'"
            >
              <template v-if="account.qoderParse.ok">
                {{ $t('settings.qoderManualDetected', { site: actions.qoderSiteName(account.qoderParse.site), n: account.qoderParse.cookieCount ?? 0 }) }}
              </template>
              <template v-else>{{ $t('settings.qoderManualInvalid') }}</template>
            </div>
            <div
              v-else-if="(isQoder && account.qoderHasWebToken && !account.qoderCaptureDirty)
                || (!isQoder && account.stepfunHasWebToken && !account.stepfunTokenDirty)"
              class="hint is-ok"
            >
              {{ isQoder ? $t('settings.qoderManualSaved') : $t('settings.stepfunManualSaved') }}
            </div>
          </template>

          <!-- 网页登录 -->
          <template v-else-if="isWebLogin(account)">
            <div v-if="account.webTokenStatus === 'active'" class="login-row">
              <span class="login-pill">{{ $t('settings.webLoginActive') }}</span>
              <button class="logout-btn" type="button" @click="doLogout(account)">
                {{ $t('settings.webLogoutBtn') }}
              </button>
            </div>
            <button
              v-else
              class="login-btn"
              :class="{ 'is-expired': account.webTokenStatus === 'expired' }"
              type="button"
              @click="doLogin(account)"
            >
              {{ account.webTokenStatus === 'expired' ? $t('settings.webTokenExpired') : $t(loginLabelKey) }}
            </button>
            <div v-if="info.key === 'qwen'" class="hint qwen-hint">{{ $t('settings.qwenLoginHint') }}</div>
          </template>

          <!-- API Key：调真实 fetchUsage 验证 key -->
          <template v-else>
            <div class="credential-row">
              <input
                type="password"
                class="form-input"
                :value="account.apiKeyDirty ? account.apiKey : ''"
                :placeholder="account.maskedApiKey || 'API Key'"
                @input="actions.onApiKeyInput(account, $event)"
              />
              <button
                class="test-btn"
                type="button"
                :disabled="testState(account)?.status === 'testing'"
                :title="actions.testTitle(info.key, account.id)"
                @click="actions.testConnection(info, account)"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
                </svg>
                {{ $t('settings.testConnection') }}
              </button>
            </div>
            <div
              v-if="testState(account) && testState(account)?.status !== 'idle'"
              class="test-status"
              :class="`is-${testState(account)?.status}`"
            >
              <svg v-if="testState(account)?.status === 'testing'" class="spin" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
              </svg>
              <svg v-else-if="testState(account)?.status === 'success'" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
              <svg v-else width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
              <span v-if="testState(account)?.status === 'testing'">{{ $t('settings.testing') }}</span>
              <span v-else-if="testState(account)?.status === 'success'">
                {{ $t('settings.testSuccess') }} · {{ $t('settings.testLatency', { ms: testState(account)?.latencyMs }) }}
              </span>
              <span v-else>
                {{ $t('settings.testFailed') }}{{ testState(account)?.error ? ' · ' + testState(account)?.error : '' }}
              </span>
            </div>
          </template>
        </div>
      </div>

      <button class="add-account" type="button" @click="actions.addAccount(info.key)">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
        </svg>
        {{ $t('settings.addAccount') }}
      </button>
    </template>
  </div>
</template>

<script setup lang="ts">
import type { AccountInfo, ProviderInfo, ProviderSettingsActions, TestState } from './provider-settings-types'

const props = defineProps<{ info: ProviderInfo; actions: ProviderSettingsActions }>()

const LOGIN_LABEL_KEY: Record<string, string> = {
  deepseek: 'settings.webLoginBtn',
  mimo: 'settings.mimoLoginBtn',
  qwen: 'settings.qwenLoginBtn',
  qoder: 'settings.qoderLoginBtn',
  stepfun: 'settings.stepfunLoginBtn',
}

type Site = 'cn' | 'global'
type Source = 'session' | 'manual'

const key = props.info.key
const isDeepseek = key === 'deepseek'
const isQoder = key === 'qoder'
const isQoderOrStepfun = isQoder || key === 'stepfun'
const hasAuthSeg = isDeepseek || isQoderOrStepfun
const loginLabelKey = LOGIN_LABEL_KEY[key] ?? 'settings.webLoginBtn'
const sourceSessionKey = isQoder ? 'settings.qoderSourceSession' : 'settings.stepfunSourceSession'
const sourceManualKey = isQoder ? 'settings.qoderSourceManual' : 'settings.stepfunSourceManual'

/** Qoder 的站点字段取值是 international / china，这里统一成 cn / global 便于比较 */
function siteModel(account: AccountInfo): Site {
  return isQoder
    ? (account.qoderSite === 'china' ? 'cn' : 'global')
    : (account.region === 'global' ? 'global' : 'cn')
}
function setSite(account: AccountInfo, site: Site) {
  if (isQoder) {
    account.qoderSite = site === 'cn' ? 'china' : 'international'
  } else {
    account.region = site
  }
}
function isManual(account: AccountInfo): boolean {
  if (!isQoderOrStepfun) return false
  return isQoder
    ? account.qoderCookieSource === 'manual'
    : account.stepfunCookieSource === 'manual'
}
function setSource(account: AccountInfo, source: Source) {
  if (isQoder) {
    account.qoderCookieSource = source
  } else {
    account.stepfunCookieSource = source
  }
}
function hasSiteSeg(account: AccountInfo): boolean {
  if (isQoderOrStepfun) return !isManual(account)
  return key === 'zhipu' || key === 'qwen'
}
function isWebLogin(account: AccountInfo): boolean {
  if (isQoderOrStepfun || key === 'mimo' || key === 'qwen') return true
  return account.authMode === 'weblogin'
}
function testState(account: AccountInfo): TestState | undefined {
  return props.actions.getTestState(props.info.key, account.id)
}
function doLogin(account: AccountInfo) {
  const a = props.actions
  switch (key) {
    case 'deepseek': return a.deepseekWebLogin(account)
    case 'mimo': return a.mimoWebLogin(account)
    case 'qwen': return a.qwenWebLogin(account)
    case 'qoder': return a.qoderWebLogin(account)
    case 'stepfun': return a.stepfunWebLogin(account)
  }
}
function doLogout(account: AccountInfo) {
  const a = props.actions
  switch (key) {
    case 'deepseek': return a.deepseekWebLogout(account)
    case 'mimo': return a.mimoWebLogout(account)
    case 'qwen': return a.qwenWebLogout(account)
    case 'qoder': return a.qoderWebLogout(account)
    case 'stepfun': return a.stepfunWebLogout(account)
  }
}
</script>

<style scoped>
.provider-panel {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

/* ===== 账户卡片 ===== */
.account-card {
  padding: 10px 12px;
  border-radius: 8px;
  background: var(--bg-settings-card);
}

.account-head {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 24px;
}

.account-head .toggle-row {
  gap: 0;
  flex-shrink: 0;
}

.account-name {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-heading);
  background: transparent;
  border: none;
  outline: none;
  padding: 0;
}
.account-name::placeholder {
  color: var(--text-tertiary);
  font-weight: 500;
}

.account-desc {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  line-height: 1.45;
  color: var(--text-secondary);
}

.account-delete {
  width: 24px;
  height: 24px;
  flex-shrink: 0;
  padding: 5px;
  color: var(--text-tertiary);
}
.account-delete:hover {
  background: transparent;
  color: #ef4444;
}
.account-delete:focus-visible {
  outline: 2px solid var(--border-focus);
  outline-offset: -2px;
}

.account-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 10px;
}

.add-account {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 34px;
  flex-shrink: 0;
  font-size: 12px;
  font-family: inherit;
  color: var(--text-tertiary);
  background: transparent;
  border: 1px dashed var(--border-default);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.15s;
}
.add-account:hover,
.add-account:focus-visible {
  border-color: #3B82F6;
  color: #3B82F6;
  outline: none;
}

/* ===== 设置行 + 分段控件 ===== */
.setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: 26px;
}

.setting-label {
  font-size: 12px;
  color: var(--text-secondary);
}

.seg {
  display: flex;
  gap: 2px;
  padding: 2px;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.05);
}
html.dark .seg {
  background: rgba(0, 0, 0, 0.3);
}

.seg-option {
  position: relative;
  display: flex;
  align-items: center;
  padding: 3px 10px;
  border-radius: 4px;
  font-size: 11px;
  color: var(--text-tertiary);
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.15s, color 0.15s, box-shadow 0.15s;
}
.seg-option:has(input:checked) {
  background: #fff;
  box-shadow: var(--shadow-card);
  color: var(--text-heading);
  font-weight: 500;
}
html.dark .seg-option:has(input:checked) {
  background: rgba(255, 255, 255, 0.14);
}
.seg-option:has(input:focus-visible) {
  outline: 2px solid var(--border-focus);
  outline-offset: -2px;
}

/* 原生 radio 缩到 1px 并透明：视觉由 .seg-option 承担，保留键盘可达 */
.seg-option input[type="radio"] {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  margin: 0;
  pointer-events: none;
}

/* ===== API Key ===== */
.credential-row {
  display: flex;
  align-items: center;
  gap: 4px;
}
.credential-row .form-input {
  min-width: 0;
}

.test-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  height: 28px;
  flex-shrink: 0;
  padding: 0 10px;
  font-size: 11px;
  font-family: inherit;
  color: var(--text-secondary);
  background: transparent;
  border: 1px solid var(--border-default);
  border-radius: 6px;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.15s;
}
.test-btn:hover:not(:disabled) {
  border-color: #3B82F6;
  color: #3B82F6;
}
.test-btn:disabled {
  cursor: not-allowed;
  opacity: 0.7;
}
.test-btn:focus-visible {
  outline: 2px solid var(--border-focus);
  outline-offset: -2px;
}

.test-status {
  display: flex;
  align-items: flex-start;
  gap: 5px;
  font-size: 11px;
  line-height: 1.4;
  color: var(--text-tertiary);
  word-break: break-word;
}
.test-status svg {
  flex-shrink: 0;
  margin-top: 1px;
}
.test-status.is-success {
  color: #16a34a;
}
.test-status.is-failed {
  color: #dc2626;
}
.test-status .spin {
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  to { transform: rotate(360deg); }
}

/* ===== 手动粘贴 ===== */
.capture-input.form-input {
  width: 100%;
  min-height: 54px;
  resize: vertical;
  font-size: 11px;
  line-height: 1.5;
  font-family: inherit;
}

.hint {
  font-size: 10px;
  line-height: 1.5;
}
.hint.is-ok {
  color: #16a34a;
}
.hint.is-error {
  color: #dc2626;
}
.hint.qwen-hint {
  color: var(--text-secondary);
}

/* ===== 网页登录 ===== */
.login-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 28px;
}

.login-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 24px;
  padding: 0 10px;
  font-size: 11px;
  border: 1px solid #22C55E;
  border-radius: 6px;
  color: #16a34a;
}
.login-pill::before {
  content: '';
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #22C55E;
}

.logout-btn {
  height: 24px;
  padding: 0 10px;
  font-size: 11px;
  font-family: inherit;
  color: var(--text-secondary);
  background: transparent;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.15s;
}
.logout-btn:hover {
  color: #ef4444;
}
.logout-btn:focus-visible {
  outline: 2px solid var(--border-focus);
  outline-offset: -2px;
}

.login-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 28px;
  padding: 0 12px;
  font-size: 11px;
  font-family: inherit;
  color: var(--text-secondary);
  background: var(--bg-input);
  border: 1px solid transparent;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.15s;
}
.login-btn:hover {
  border-color: #3B82F6;
  color: #3B82F6;
}
.login-btn:focus-visible {
  outline: 2px solid var(--border-focus);
  outline-offset: -2px;
}
.login-btn.is-expired {
  border-color: #f59e0b;
  color: #b45309;
}
html.dark .login-btn.is-expired {
  color: #facc15;
}
</style>
