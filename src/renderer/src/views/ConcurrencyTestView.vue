<template>
  <div class="view-concurrency">
    <header class="header">
      <button class="icon-btn back-btn" :title="$t('settings.backBtn')" @click="showHistory ? (showHistory = false) : $emit('go-back')">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="15 18 9 12 15 6"/>
        </svg>
      </button>
      <h1>{{ showHistory ? $t('concurrencyTest.history') : $t('concurrencyTest.title') }}</h1>
      <button v-if="!showHistory" class="icon-btn history-btn" :title="$t('concurrencyTest.history')" @click="openHistory">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
        </svg>
      </button>
    </header>

    <!-- 历史记录页 -->
    <div v-if="showHistory" class="history-body">
      <div v-if="showClearConfirm" class="clear-confirm">
        <span>{{ $t('concurrencyTest.clearConfirm') }}</span>
        <button class="confirm-yes" @click="clearAllHistory">{{ $t('concurrencyTest.confirmYes') }}</button>
        <button class="confirm-no" @click="showClearConfirm = false">{{ $t('concurrencyTest.confirmNo') }}</button>
      </div>
      <div class="history-top">
        <span class="history-count">{{ history.length }} {{ $t('concurrencyTest.noHistory').length > 0 ? '' : '' }}</span>
        <button v-if="history.length > 0" class="clear-all-btn" @click="confirmClearAll">
          {{ $t('concurrencyTest.clearAll') }}
        </button>
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
    </div>

    <!-- 测试页 -->
    <div v-else class="test-body">
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

      <!-- 测试过程：每个请求一行 -->
      <div v-if="testing || result" class="progress-list">
        <div v-for="(s, i) in requestStates" :key="i" class="request-row" @mouseenter="hoveredIndex = i" @mouseleave="hoveredIndex = -1">
          <span class="indicator" :class="s" />
          <span class="request-text">{{ tailText(requestTexts[i]) }}</span>
          <!-- 悬浮信息 -->
          <div v-if="hoveredIndex === i" class="row-tooltip">
            <template v-if="s === 'pending'">
              <span>Waiting... {{ elapsedStr(i) }}</span>
            </template>
            <template v-else-if="s === 'streaming'">
              <span>Streaming {{ elapsedStr(i) }}</span>
            </template>
            <template v-else-if="s === 'success'">
              <span>TTFT {{ (requestMetrics[i].ttftMs / 1000).toFixed(2) }}s · Total {{ (requestMetrics[i].totalMs / 1000).toFixed(2) }}s · {{ requestMetrics[i].tokensPerSec }} tok/s</span>
            </template>
            <template v-else-if="s === 'fail'">
              <span class="tooltip-error">{{ requestMetrics[i].error || 'Failed' }}</span>
            </template>
          </div>
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
            <span>{{ (result.avgTtftMs / 1000).toFixed(2) }} {{ $t('concurrencyTest.seconds') }}</span>
          </div>
          <div class="detail-row">
            <span>{{ $t('concurrencyTest.avgSpeed') }}</span>
            <span>{{ result.avgTokensPerSec }} {{ $t('concurrencyTest.tokPerSec') }}</span>
          </div>
          <div class="detail-row">
            <span>{{ $t('concurrencyTest.ttftRange') }}</span>
            <span>{{ (result.minTtftMs / 1000).toFixed(2) }}/{{ (result.maxTtftMs / 1000).toFixed(2) }} {{ $t('concurrencyTest.seconds') }}</span>
          </div>
        </div>
      </div>
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
const requestStates = ref<('pending' | 'streaming' | 'success' | 'fail')[]>([])
const requestTexts = ref<string[]>([])
const requestMetrics = ref<{ ttftMs: number; totalMs: number; tokenCount: number; tokensPerSec: number; error?: string }[]>([])
const showHistory = ref(false)
const hoveredIndex = ref(-1)
const testStartTime = ref(0)
const now = ref(Date.now())
let timerHandle: ReturnType<typeof setInterval> | undefined

const runningText = computed(() => {
  return t('concurrencyTest.running', {
    completed: progress.value.completed,
    total: progress.value.total,
  })
})

function onProgress(data: { index: number; total: number; success: boolean; ttftMs: number; totalMs: number; tokenCount: number; tokensPerSec: number; error?: string }) {
  if (requestStates.value.length !== data.total) {
    requestStates.value = Array(data.total).fill('pending')
    requestTexts.value = Array(data.total).fill('')
    requestMetrics.value = Array(data.total).fill(null)
  }
  requestStates.value[data.index] = data.success ? 'success' : 'fail'
  requestMetrics.value[data.index] = { ttftMs: data.ttftMs, totalMs: data.totalMs, tokenCount: data.tokenCount, tokensPerSec: data.tokensPerSec, error: data.error }
  progress.value = {
    completed: requestStates.value.filter(s => s !== 'pending' && s !== 'streaming').length,
    total: data.total,
  }
}

function onStreamText(info: { index: number; text: string }) {
  if (requestTexts.value.length > info.index) {
    requestTexts.value[info.index] += info.text
  }
}

function onFirstContent(info: { index: number; total: number }) {
  if (requestStates.value[info.index] === 'pending') {
    requestStates.value[info.index] = 'streaming'
  }
}

function tailText(text: string | undefined): string {
  if (!text) return ''
  return text.length > 80 ? '…' + text.slice(-80) : text
}

function elapsedStr(_index: number): string {
  const ms = now.value - testStartTime.value
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

async function startTest() {
  testing.value = true
  result.value = null
  progress.value = { completed: 0, total: concurrency.value }
  requestStates.value = Array(concurrency.value).fill('pending')
  requestTexts.value = Array(concurrency.value).fill('')
  requestMetrics.value = Array(concurrency.value).fill(null)
  testStartTime.value = Date.now()
  now.value = Date.now()
  timerHandle = setInterval(() => { now.value = Date.now() }, 100)

  try {
    const res = await window.electronAPI.concurrencyTestStart({
      providerKey: 'zhipu',
      model: selectedModel.value,
      concurrency: concurrency.value,
      apiFormat: apiFormat.value,
    })
    testing.value = false
    result.value = res
    clearInterval(timerHandle)
    timerHandle = undefined
    await loadHistory()
  } catch (e) {
    console.error('[ConcurrencyTest] Test failed:', e)
    testing.value = false
    clearInterval(timerHandle)
    timerHandle = undefined
  }
}

async function loadHistory() {
  try {
    history.value = await window.electronAPI.concurrencyTestGetHistory('zhipu')
  } catch {
    history.value = []
  }
}

function openHistory() {
  loadHistory()
  showHistory.value = true
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
  window.electronAPI.onConcurrencyTestFirstContent(onFirstContent)
})

onUnmounted(() => {
  window.electronAPI.offConcurrencyTestProgress(onProgress)
  window.electronAPI.offConcurrencyTestStream(onStreamText)
  window.electronAPI.offConcurrencyTestFirstContent(onFirstContent)
  if (timerHandle) clearInterval(timerHandle)
})
</script>

<style scoped>
.view-concurrency {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border-subtle, rgba(255,255,255,0.06));
}

.header h1 {
  flex: 1;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}

.icon-btn {
  background: none;
  border: none;
  color: var(--text-secondary);
  cursor: pointer;
  padding: 5px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: color 0.15s, background 0.15s;
}
.icon-btn:hover {
  color: var(--text-primary);
  background: var(--border-subtle, rgba(255,255,255,0.06));
}

/* 测试页 */
.test-body {
  flex: 1;
  overflow-y: auto;
  padding: 0 10px 10px;
  display: flex;
  flex-direction: column;
}

.test-body::-webkit-scrollbar { width: 3px; }
.test-body::-webkit-scrollbar-thumb { background: var(--scrollbar-thumb); border-radius: 2px; }

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
  font-size: 12px;
  color: var(--text-secondary);
  min-width: 48px;
}

.config-select {
  flex: 1;
  font-size: 12px;
  padding: 6px 8px;
  border: 1px solid var(--border-default);
  border-radius: 6px;
  background: var(--bg-input);
  color: var(--text-primary);
  outline: none;
}

.start-btn {
  font-size: 12px;
  padding: 6px 12px;
  border: 1px solid var(--border-default);
  border-radius: 6px;
  background: var(--bg-settings-card);
  color: var(--text-primary);
  cursor: pointer;
  transition: background 0.2s, border-color 0.2s;
  margin-bottom: 6px;
}
.start-btn:hover:not(:disabled) {
  border-color: var(--text-tertiary);
}
.start-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* 请求行列表 */
.progress-list {
  background: var(--bg-settings-card);
  border-radius: 8px;
  padding: 8px 10px;
  margin-bottom: 6px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.request-row {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  min-height: 14px;
  position: relative;
}

.row-tooltip {
  position: absolute;
  left: 0;
  top: 100%;
  z-index: 10;
  font-size: 10px;
  line-height: 1.4;
  color: var(--text-primary);
  background: var(--bg-settings-card);
  border: 1px solid var(--border-default);
  border-radius: 6px;
  padding: 4px 8px;
  white-space: nowrap;
  pointer-events: none;
  box-shadow: 0 2px 8px rgba(0,0,0,0.3);
  max-width: 280px;
}

.tooltip-error {
  white-space: normal;
  word-break: break-all;
  color: var(--text-error, #f87171);
}

.indicator {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  margin-top: 3px;
  flex-shrink: 0;
  transition: background 0.2s, box-shadow 0.2s;
}
.indicator.pending {
  background: var(--border-default, rgba(255,255,255,0.12));
  box-shadow: none;
}
.indicator.streaming {
  background: var(--color-warning, #EAB308);
  box-shadow: 0 0 4px rgba(234, 179, 8, 0.4);
}
.indicator.success {
  background: var(--color-success, #22C55E);
  box-shadow: 0 0 4px rgba(34, 197, 94, 0.4);
}
.indicator.fail {
  background: var(--color-error, #ef4444);
  box-shadow: 0 0 4px rgba(239, 68, 68, 0.4);
}

.request-text {
  font-size: 10px;
  line-height: 14px;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
}

.stream-cursor {
  animation: blink 0.8s step-end infinite;
  color: var(--text-tertiary);
  font-size: 10px;
}
@keyframes blink {
  50% { opacity: 0; }
}

/* 结果 */
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
  font-size: 12px;
  color: var(--text-secondary);
}

.main-result strong {
  font-size: 12px;
}

.text-green { color: var(--color-success, #22C55E); }
.text-yellow { color: var(--color-warning, #EAB308); }

.result-details {
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px solid var(--border-subtle);
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

/* 历史记录页 */
.history-body {
  flex: 1;
  overflow-y: auto;
  padding: 0 10px 10px;
}

.history-body::-webkit-scrollbar { width: 3px; }
.history-body::-webkit-scrollbar-thumb { background: var(--scrollbar-thumb); border-radius: 2px; }

.history-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 0;
}

.history-count {
  font-size: 10px;
  color: var(--text-tertiary);
}

.clear-all-btn {
  font-size: 10px;
  color: var(--text-tertiary);
  background: none;
  border: none;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 6px;
  transition: color 0.15s, background 0.15s;
}
.clear-all-btn:hover {
  color: var(--color-error, #ef4444);
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
  border-radius: 6px;
  padding: 2px 8px;
  cursor: pointer;
}
.confirm-yes {
  background: var(--color-error, #ef4444);
  color: #fff;
}
.confirm-yes:hover {
  background: var(--color-error-dark, #dc2626);
}
.confirm-no {
  background: var(--border-default);
  color: var(--text-secondary);
}
.confirm-no:hover {
  background: var(--border-subtle);
}

.history-list {
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
  border-bottom: 1px solid var(--border-subtle);
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
  color: var(--color-error, #ef4444);
}

.history-empty {
  font-size: 10px;
  color: var(--text-empty-hint, var(--text-tertiary));
  margin-top: 4px;
}
</style>
