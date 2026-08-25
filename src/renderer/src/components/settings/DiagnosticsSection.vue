<template>
  <div class="form-group">
    <label class="form-label">{{ $t('settings.diagnostics') }}</label>
    <div class="diag-row">
      <span class="diag-label">{{ $t('settings.configPath') }}</span>
      <code class="diag-path" :title="configPath">{{ configPath || '...' }}</code>
      <button class="diag-btn" @click="$emit('open-folder')">{{ $t('settings.openConfigFolder') }}</button>
    </div>
    <div class="diag-row">
      <button class="diag-btn" :disabled="reloading" @click="$emit('reload')">
        {{ reloading ? '...' : $t('settings.reloadConfig') }}
      </button>
      <button class="diag-btn" :disabled="pinging" @click="$emit('ping-all')">
        {{ pinging ? '...' : $t('settings.testAllProviders') }}
      </button>
      <button class="diag-btn" @click="$emit('view-log')">
        {{ $t('settings.viewLog') }}
      </button>
      <span v-if="pingResult" class="diag-ping-result" :class="pingResult.failed === 0 ? 'ok' : 'partial'">
        {{ pingResult.failed === 0
            ? $t('settings.pingAllSuccess')
            : $t('settings.pingAllSomeFailed', { n: pingResult.ok, total: pingResult.total }) }}
      </span>
    </div>
    <details v-if="logTail.length > 0" class="diag-log">
      <summary>{{ $t('settings.recentLogLines', { n: logTail.length }) }}</summary>
      <pre>{{ logTail.join('\n') }}</pre>
    </details>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  configPath: string
  reloading: boolean
  pinging: boolean
  pingResult: { ok: number; failed: number; total: number } | null
  logTail: string[]
}>()

defineEmits<{
  'open-folder': []
  reload: []
  'ping-all': []
  'view-log': []
}>()
</script>

<style scoped>
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
.diag-log {
  margin-top: 4px;
  font-size: 10px;
  color: var(--text-tertiary);
}
.diag-log summary {
  cursor: pointer;
  user-select: none;
  padding: 2px 0;
}
.diag-log summary:hover { color: var(--text-secondary); }
.diag-log pre {
  margin: 4px 0 0;
  padding: 6px 8px;
  background: var(--bg-input);
  border: 1px solid var(--border-subtle);
  border-radius: 4px;
  font-size: 9px;
  font-family: ui-monospace, monospace;
  max-height: 160px;
  overflow-y: auto;
  white-space: pre-wrap;
  word-break: break-all;
  color: var(--text-secondary);
}
</style>
