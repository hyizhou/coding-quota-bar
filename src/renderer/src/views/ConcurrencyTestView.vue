<template>
  <div class="view-concurrency">
    <header class="header">
      <button class="icon-btn back-btn" :title="$t('settings.backBtn')" @click="$emit('go-back')">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="15 18 9 12 15 6"/>
        </svg>
      </button>
      <h1>{{ $t('concurrencyTest.title') }}</h1>
    </header>

    <div class="test-body">
      <!-- 第一页：测试 -->
      <section class="page test-page">
        <p class="disclaimer">{{ $t('concurrencyTest.disclaimer') }}</p>
        <div class="settings-card">
          <div class="config-row">
            <label class="config-label">{{ $t('concurrencyTest.apiFormat') }}</label>
            <select v-model="apiFormat" class="config-select" :disabled="testing">
              <option value="openai">OpenAI</option>
              <option value="anthropic">Anthropic</option>
            </select>
          </div>

          <div class="config-row">
            <label class="config-label">{{ $t('concurrencyTest.model') }}</label>
            <select v-model="selectedModel" class="config-select" :disabled="testing">
              <option v-for="m in models" :key="m" :value="m">{{ m }}</option>
            </select>
          </div>

          <div class="config-row">
            <label class="config-label">{{ $t('concurrencyTest.concurrency') }}</label>
            <select v-model="concurrency" class="config-select" :disabled="testing">
              <option v-for="n in concurrencyOptions" :key="n" :value="n">{{ n }}</option>
            </select>
          </div>
        </div>

        <button
          class="start-btn"
          :disabled="testing || !selectedModel"
          @click="startTest"
        >
          <template v-if="testing">{{ runningText }}</template>
          <template v-else>{{ $t('concurrencyTest.start') }}</template>
        </button>

        <!-- 测试过程 -->
        <div v-if="testing" class="progress-card">
          <div class="progress-dots">
            <span v-for="(s, i) in requestStates" :key="i" class="dot" :class="s" />
          </div>
          <div v-if="streamText" ref="streamEl" class="stream-preview">
            <span class="stream-text">{{ streamText }}</span><span class="stream-cursor">|</span>
          </div>
        </div>

        <!-- 结果 -->
        <div v-if="result" class="result-card">
          <div class="result-row main-result">
            <span>{{ $t('concurrencyTest.success') }}: <strong :class="result.successCount === result.concurrency ? 'text-green' : 'text-yellow'">{{ result.successCount }}/{{ result.concurrency }}</strong></span>
            <span>{{ $t('concurrencyTest.totalTime') }}: {{ formatTime(result.totalTimeMs) }}</span>
          </div>
          <div v-if="result.successCount > 0" class="result-details">
            <div class="detail-row">
              <span>{{ $t('concurrencyTest.avgTtft') }}</span>
              <span>{{ result.avgTtftMs }} {{ $t('concurrencyTest.ms') }}</span>
            </div>
            <div class="detail-row">
              <span>{{ $t('concurrencyTest.avgSpeed') }}</span>
              <span>{{ result.avgTokensPerSec }} {{ $t('concurrencyTest.tokPerSec') }}</span>
            </div>
            <div class="detail-row">
              <span>{{ $t('concurrencyTest.ttftRange') }}</span>
              <span>{{ result.minTtftMs }}/{{ result.maxTtftMs }} {{ $t('concurrencyTest.ms') }}</span>
            </div>
          </div>
        </div>

        <div class="page-hint">{{ $t('concurrencyTest.history') }} ↓</div>
      </section>

      <!-- 第二页：历史记录 -->
      <section class="page history-page">
        <div class="history-header">
          <span>{{ $t('concurrencyTest.history') }} ({{ history.length }})</span>
          <button v-if="history.length > 0" class="clear-all-btn" @click="confirmClearAll">
            {{ $t('concurrencyTest.clearAll') }}
          </button>
        </div>
        <div v-if="showClearConfirm" class="clear-confirm">
          <span>{{ $t('concurrencyTest.clearConfirm') }}</span>
          <button class="confirm-yes" @click="clearAllHistory">{{ $t('concurrencyTest.confirmYes') }}</button>
          <button class="confirm-no" @click="showClearConfirm = false">{{ $t('concurrencyTest.confirmNo') }}</button>
        </div>
        <div v-if="history.length > 0" class="history-list">
          <div v-for="h in history" :key="h.id" class="history-item">
            <div class="history-main">
              <span class="history-time">{{ formatTimestamp(h.timestamp) }}</span>
              <span class="history-model">{{ h.model }}</span>
              <button class="history-delete" :title="$t('concurrencyTest.delete')" @click="deleteHistory(h.id)">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>
            <div class="history-metrics">
              <span :class="h.successCount === h.concurrency ? 'text-green' : 'text-yellow'">{{ h.successCount }}/{{ h.concurrency }}</span>
              <span v-if="h.successCount > 0">TTFT {{ h.avgTtftMs }}{{ $t('concurrencyTest.ms') }}</span>
              <span v-if="h.successCount > 0">{{ h.avgTokensPerSec }}{{ $t('concurrencyTest.tokPerSec') }}</span>
            </div>
          </div>
        </div>
        <div v-else class="history-empty">
          {{ $t('concurrencyTest.noHistory') }}
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ApiFormat, ConcurrencyTestResult } from '../types'

defineEmits<{ 'go-back': [] }>()

const ZHIPU_CODING_MODELS = ['GLM-5.1', 'GLM-5-Turbo', 'GLM-5v-Turbo', 'GLM-4.7', 'GLM-4.5-Air'] as const

const { t } = useI18n()

const models = ZHIPU_CODING_MODELS
const concurrencyOptions = [1, 3, 5, 10, 15, 20, 30, 50]

const selectedModel = ref<string>('GLM-5.1')
const concurrency = ref(10)
const apiFormat = ref<ApiFormat>('openai')
const testing = ref(false)
const result = ref<ConcurrencyTestResult | null>(null)
const history = ref<ConcurrencyTestResult[]>([])
const progress = ref({ completed: 0, total: 0 })
const requestStates = ref<('pending' | 'success' | 'fail')[]>([])
const streamText = ref('')
const streamEl = ref<HTMLElement | null>(null)

const runningText = computed(() => {
  return t('concurrencyTest.running', {
    completed: progress.value.completed,
    total: progress.value.total,
  })
})

function onProgress(data: { index: number; total: number; success: boolean }) {
  if (requestStates.value.length !== data.total) {
    requestStates.value = Array(data.total).fill('pending')
  }
  requestStates.value[data.index] = data.success ? 'success' : 'fail'
  progress.value = {
    completed: requestStates.value.filter(s => s !== 'pending').length,
    total: data.total,
  }
}

function onStreamText(text: string) {
  streamText.value += text
  nextTick(() => {
    if (streamEl.value) streamEl.value.scrollTop = streamEl.value.scrollHeight
  })
}

async function startTest() {
  testing.value = true
  result.value = null
  progress.value = { completed: 0, total: concurrency.value }
  requestStates.value = Array(concurrency.value).fill('pending')
  streamText.value = ''

  try {
    const res = await window.electronAPI.concurrencyTestStart({
      providerKey: 'zhipu',
      model: selectedModel.value,
      concurrency: concurrency.value,
      apiFormat: apiFormat.value,
    })
    testing.value = false
    result.value = res
    await loadHistory()
  } catch (e) {
    console.error('[ConcurrencyTest] Test failed:', e)
    testing.value = false
  }
}

async function loadHistory() {
  try {
    history.value = await window.electronAPI.concurrencyTestGetHistory('zhipu')
  } catch {
    history.value = []
  }
}

async function deleteHistory(id: string) {
  try {
    await window.electronAPI.concurrencyTestDelete('zhipu', id)
    history.value = history.value.filter(h => h.id !== id)
  } catch {
    // ignore
  }
}

const showClearConfirm = ref(false)

function confirmClearAll() {
  showClearConfirm.value = true
}

async function clearAllHistory() {
  showClearConfirm.value = false
  for (const h of history.value) {
    try {
      await window.electronAPI.concurrencyTestDelete('zhipu', h.id)
    } catch {
      // ignore
    }
  }
  history.value = []
}

function formatTime(ms: number): string {
  if (ms < 1000) return `${ms}${t('concurrencyTest.ms')}`
  return `${(ms / 1000).toFixed(1)}${t('concurrencyTest.seconds')}`
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

onMounted(() => {
  loadHistory()
  window.electronAPI.onConcurrencyTestProgress(onProgress)
  window.electronAPI.onConcurrencyTestStream(onStreamText)
})

onUnmounted(() => {
  window.electronAPI.offConcurrencyTestProgress(onProgress)
  window.electronAPI.offConcurrencyTestStream(onStreamText)
})
</script>

<style scoped>
.view-concurrency {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.test-body {
  flex: 1;
  overflow-y: auto;
  scroll-snap-type: y mandatory;
  -webkit-overflow-scrolling: touch;
}

.test-body::-webkit-scrollbar { width: 3px; }
.test-body::-webkit-scrollbar-thumb { background: var(--scrollbar-thumb); border-radius: 2px; }

.page {
  min-height: 100%;
  scroll-snap-align: start;
  padding: 0 10px;
  display: flex;
  flex-direction: column;
}

.page-hint {
  margin-top: auto;
  padding-top: 8px;
  font-size: 9px;
  color: var(--text-quaternary, rgba(120, 120, 140, 0.4));
  text-align: center;
}

.history-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  padding: 4px 0 6px;
}

.clear-all-btn {
  font-size: 10px;
  color: var(--text-tertiary);
  background: none;
  border: none;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 4px;
  transition: color 0.15s, background 0.15s;
}
.clear-all-btn:hover {
  color: #ef4444;
  background: rgba(239, 68, 68, 0.1);
}

.clear-confirm {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 10px;
  color: var(--text-secondary);
  padding: 6px 10px;
  background: var(--bg-settings-card);
  border-radius: 6px;
  margin-bottom: 6px;
}
.confirm-yes, .confirm-no {
  font-size: 10px;
  border: none;
  border-radius: 4px;
  padding: 2px 8px;
  cursor: pointer;
}
.confirm-yes {
  background: #ef4444;
  color: #fff;
}
.confirm-yes:hover {
  background: #dc2626;
}
.confirm-no {
  background: var(--border-default, rgba(255,255,255,0.12));
  color: var(--text-secondary);
}
.confirm-no:hover {
  background: var(--border-subtle, rgba(255,255,255,0.06));
}

.history-page {
  padding-bottom: 10px;
}

.disclaimer {
  font-size: 10px;
  color: var(--text-tertiary);
  line-height: 1.4;
  padding: 4px 0 6px;
  text-align: center;
}

.settings-card {
  background: var(--bg-settings-card);
  border-radius: 8px;
  padding: 10px 12px;
  margin-bottom: 6px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.config-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.config-label {
  font-size: 11px;
  color: var(--text-secondary);
  min-width: 48px;
}

.config-select {
  flex: 1;
  font-size: 11px;
  padding: 3px 6px;
  border: 1px solid var(--border-default);
  border-radius: 4px;
  background: var(--bg-input);
  color: var(--text-primary);
  outline: none;
}

.start-btn {
  font-size: 11px;
  padding: 6px 12px;
  border: none;
  border-radius: 5px;
  background: #3B82F6;
  color: #fff;
  cursor: pointer;
  transition: background 0.2s;
  margin-bottom: 6px;
}
.start-btn:hover:not(:disabled) {
  background: #2563EB;
}
.start-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.progress-card {
  background: var(--bg-settings-card);
  border-radius: 8px;
  padding: 10px 12px;
  margin-bottom: 6px;
}

.progress-dots {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  justify-content: center;
  margin-bottom: 6px;
}

.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  transition: background 0.2s;
}
.dot.pending { background: var(--border-default, rgba(255,255,255,0.12)); }
.dot.success { background: #22C55E; }
.dot.fail { background: #EAB308; }

.stream-preview {
  font-size: 10px;
  line-height: 1.5;
  color: var(--text-secondary);
  max-height: 80px;
  overflow-y: auto;
  word-break: break-all;
}
.stream-preview::-webkit-scrollbar { width: 2px; }
.stream-preview::-webkit-scrollbar-thumb { background: var(--scrollbar-thumb); border-radius: 2px; }

.stream-cursor {
  animation: blink 0.8s step-end infinite;
  color: var(--text-tertiary);
}
@keyframes blink {
  50% { opacity: 0; }
}

.result-card {
  background: var(--bg-settings-card);
  border-radius: 8px;
  padding: 10px 12px;
  margin-bottom: 6px;
}

.result-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 11px;
  color: var(--text-secondary);
}

.main-result strong {
  font-size: 12px;
}

.text-green { color: #22C55E; }
.text-yellow { color: #EAB308; }

.result-details {
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px solid var(--border-subtle, rgba(255,255,255,0.06));
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.detail-row {
  display: flex;
  justify-content: space-between;
  font-size: 10px;
  color: var(--text-tertiary);
}

.history-list {
  margin-top: 4px;
  background: var(--bg-settings-card);
  border-radius: 8px;
  padding: 8px 12px;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.history-item {
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: 3px 0;
  border-bottom: 1px solid var(--border-subtle, rgba(255,255,255,0.04));
}

.history-item:last-child {
  border-bottom: none;
}

.history-main {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 10px;
  color: var(--text-secondary);
  padding-right: 16px;
  position: relative;
}

.history-time { min-width: 72px; }
.history-model { flex: 1; text-align: center; }

.history-metrics {
  display: flex;
  justify-content: space-between;
  font-size: 9px;
  color: var(--text-tertiary);
}

.history-delete {
  position: absolute;
  right: 0;
  top: 50%;
  transform: translateY(-50%);
  background: none;
  border: none;
  padding: 1px;
  cursor: pointer;
  color: var(--text-tertiary);
  opacity: 0;
  transition: opacity 0.15s, color 0.15s;
}
.history-item:hover .history-delete {
  opacity: 1;
}
.history-delete:hover {
  color: #ef4444;
}

.history-empty {
  font-size: 10px;
  color: var(--text-empty-hint, var(--text-tertiary));
  margin-top: 4px;
}
</style>
