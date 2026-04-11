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

    <div class="settings-body">
      <div class="section-label">{{ $t('settings.providerSection') }}</div>

      <div v-for="info in providerList" :key="info.key" class="settings-card">
        <label class="toggle-row">
          <input type="checkbox" v-model="info.enabled" />
          <span class="toggle-switch"></span>
          <span class="toggle-label">{{ info.label }}</span>
        </label>
        <div class="provider-body" v-if="info.enabled">
          <div class="import-btns">
            <button
              class="import-btn"
              :title="$t('settings.importFromEnvTooltip')"
              @click="handleImportFromEnv(info)"
            >{{ $t('settings.importFromEnv') }}</button>
            <button
              class="import-btn"
              disabled
              :title="$t('settings.importFromClaudeCodeTooltip')"
            >{{ $t('settings.importFromClaudeCode') }}</button>
          </div>
          <div class="input-group">
            <input
              :type="info.showKey ? 'text' : 'password'"
              class="form-input"
              v-model="info.apiKey"
              placeholder="API Key"
            />
            <button class="icon-btn eye-btn" @click="info.showKey = !info.showKey">
              <svg v-if="info.showKey" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>
              </svg>
              <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
              </svg>
            </button>
          </div>
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
        <label class="toggle-row">
          <input type="checkbox" v-model="autoStart" />
          <span class="toggle-switch"></span>
          <span class="toggle-label">{{ $t('settings.autoStart') }}</span>
        </label>
        <div class="form-group">
          <label class="form-label">{{ $t('settings.language') }}</label>
          <select v-model="language" class="form-select">
            <option value="zh-CN">中文</option>
            <option value="en-US">English</option>
          </select>
        </div>
      </div>
    </div>

    <footer class="footer">
      <span class="save-status" :class="{ error: saveError }">{{ saveStatus }}</span>
      <template v-for="info in providerList" :key="'status-'+info.key">
        <span v-if="info.importStatus" class="save-status" :class="{ error: info.importError }">{{ info.importStatus }}</span>
      </template>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AppConfig, ProviderConfig } from '../types'

defineEmits<{ 'go-back': [] }>()

const { t, locale } = useI18n()

interface ProviderInfo {
  key: string
  label: string
  enabled: boolean
  apiKey: string
  showKey: boolean
  importStatus: string
  importError: boolean
}

const providerList = ref<ProviderInfo[]>([])
const refreshInterval = ref('300')
const autoStart = ref(false)
const language = ref('zh-CN')
const saving = ref(false)
const saveStatus = ref('')
const saveError = ref(false)
const currentConfig = ref<AppConfig | null>(null)
let saveTimer: ReturnType<typeof setTimeout> | null = null

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    saveConfig()
  }, 500)
}

onMounted(async () => {
  const config = await window.electronAPI.getConfig()
  if (!config) return
  currentConfig.value = config
  providerList.value = [
    { key: 'zhipu', label: t('providers.zhipu'), enabled: config.providers.zhipu?.enabled ?? false, apiKey: config.providers.zhipu?.apiKey ?? '', showKey: false, importStatus: '', importError: false },
    { key: 'minimax', label: 'MiniMax', enabled: config.providers.minimax?.enabled ?? false, apiKey: config.providers.minimax?.apiKey ?? '', showKey: false, importStatus: '', importError: false },
    { key: 'kimi', label: 'Kimi', enabled: config.providers.kimi?.enabled ?? false, apiKey: config.providers.kimi?.apiKey ?? '', showKey: false, importStatus: '', importError: false }
  ]
  refreshInterval.value = String(config.refreshInterval)
  autoStart.value = config.autoStart
  language.value = config.language || locale.value

  // 配置加载完后开始监听变化，自动保存
  watch([providerList, refreshInterval, autoStart, language], () => {
    scheduleSave()
  }, { deep: true })
})

async function saveConfig() {
  if (!currentConfig.value) return
  saving.value = true
  saveStatus.value = t('settings.saving')
  saveError.value = false

  const providers: Record<string, ProviderConfig> = {}
  for (const info of providerList.value) {
    providers[info.key] = {
      ...currentConfig.value!.providers[info.key],
      enabled: info.enabled,
      apiKey: info.apiKey
    }
  }

  try {
    await window.electronAPI.updateConfig({
      providers,
      refreshInterval: parseInt(refreshInterval.value, 10),
      autoStart: autoStart.value,
      language: language.value
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

async function handleImportFromEnv(info: ProviderInfo) {
  const result = await window.electronAPI.importKeyFromEnv(info.key)
  if (result.success) {
    info.importStatus = t('settings.importSuccess')
    info.importError = false
    // 刷新配置到本地
    const config = await window.electronAPI.getConfig()
    if (config) {
      currentConfig.value = config
      info.apiKey = config.providers[info.key]?.apiKey ?? ''
    }
  } else {
    info.importStatus = t('settings.importFailed', { error: result.error })
    info.importError = true
  }
  setTimeout(() => { info.importStatus = '' }, 3000)
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
.settings-body::-webkit-scrollbar-thumb { background: #ccc; border-radius: 2px; }

.settings-card {
  background: #f8f9fa;
  border-radius: 8px;
  padding: 10px 12px;
  margin-bottom: 6px;
}

.provider-body {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid #e8e8e8;
}

.import-btns {
  display: flex;
  gap: 6px;
  margin-bottom: 8px;
}

.import-btn {
  flex: 1;
  padding: 4px 8px;
  border: 1px solid #ddd;
  border-radius: 5px;
  background: #fff;
  color: #555;
  font-size: 11px;
  cursor: pointer;
  transition: all 0.2s;
}
.import-btn:hover:not(:disabled) {
  background: #f0f0f0;
  border-color: #bbb;
}
.import-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.input-group {
  display: flex;
  gap: 4px;
}

.eye-btn {
  border: 1px solid #ddd !important;
  padding: 4px 6px !important;
}

.save-status { font-size: 11px; color: #4CAF50; }
.save-status.error { color: #F44336; }
</style>
