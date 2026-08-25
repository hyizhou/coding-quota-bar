<template>
  <div class="form-group">
    <label class="form-label">{{ $t('settings.importExport') }}</label>
    <div class="import-export-row">
      <button class="io-btn" @click="$emit('export')">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
        </svg>
        <span>{{ $t('settings.exportBtn') }}</span>
      </button>
      <select :value="exportMode" @change="$emit('update:exportMode', ($event.target as HTMLSelectElement).value as 'sanitized' | 'full')" class="io-mode-select">
        <option value="sanitized">{{ $t('settings.exportSanitized') }}</option>
        <option value="full">{{ $t('settings.exportFull') }}</option>
      </select>
      <button class="io-btn" @click="$emit('import')">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
        </svg>
        <span>{{ $t('settings.importBtn') }}</span>
      </button>
    </div>
    <div v-if="confirmPending" class="import-confirm">
      <div class="import-confirm-text">
        <strong>{{ $t('settings.importConfirmTitle') }}</strong>
        <p>{{ confirmPending.isSanitized ? $t('settings.importIsSanitized') : $t('settings.importIsFull') }}</p>
        <p class="import-confirm-body">{{ $t('settings.importConfirmBody') }}</p>
      </div>
      <div class="import-confirm-actions">
        <button class="io-btn-secondary" @click="$emit('cancel-import')">{{ $t('settings.discardChanges') }}</button>
        <button class="io-btn-primary" @click="$emit('confirm-import')">{{ $t('settings.saveNow') }}</button>
      </div>
    </div>
    <div v-if="status" class="import-export-status" :class="{ error }">
      {{ status }}
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  exportMode: 'sanitized' | 'full'
  status: string
  error: boolean
  confirmPending: { config: unknown; isSanitized: boolean } | null
}>()

defineEmits<{
  export: []
  import: []
  'update:exportMode': [value: 'sanitized' | 'full']
  'cancel-import': []
  'confirm-import': []
}>()
</script>

<style scoped>
/* 全部沿用原 SettingsView 的样式（已移到全局或 inline） */
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
</style>
