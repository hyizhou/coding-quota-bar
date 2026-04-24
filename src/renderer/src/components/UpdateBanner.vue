<template>
  <div class="update-banner" @click="$emit('click')">
    <span class="update-banner-text">{{ $t('main.updateAvailableBanner', { version }) }}</span>
    <button class="update-banner-close" @click.stop="$emit('close')">&times;</button>
  </div>
</template>

<script setup lang="ts">
defineProps<{ version: string }>()
defineEmits<{ 'click': []; 'close': [] }>()
</script>

<style scoped>
.update-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 10px;
  margin: 0 10px 4px;
  background: rgba(59, 130, 246, 0.1);
  border: 1px solid rgba(59, 130, 246, 0.3);
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.15s;
  flex-shrink: 0;
}

.update-banner:hover {
  background: rgba(59, 130, 246, 0.18);
}

.update-banner-text {
  font-size: 11px;
  color: #3b82f6;
  line-height: 1.4;
}

.update-banner-close {
  background: none;
  border: none;
  color: #3b82f6;
  font-size: 14px;
  cursor: pointer;
  padding: 0 2px;
  line-height: 1;
  opacity: 0.6;
}

.update-banner-close:hover {
  opacity: 1;
}

:deep(.dark) .update-banner {
  background: rgba(59, 130, 246, 0.15);
  border-color: rgba(59, 130, 246, 0.35);
}
</style>
