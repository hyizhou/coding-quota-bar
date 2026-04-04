<template>
  <div class="app">
    <div v-if="isDev" class="dev-banner">DEV</div>
    <MainView v-if="currentView === 'main'" @open-settings="currentView = 'settings'" />
    <SettingsView v-else @go-back="currentView = 'main'" />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import MainView from './views/MainView.vue'
import SettingsView from './views/SettingsView.vue'

const currentView = ref<'main' | 'settings'>('main')
const isDev = ref(false)

function onMouseEnter() {
  window.electronAPI.notifyHoverState(true)
}

function onMouseLeave() {
  window.electronAPI.notifyHoverState(false)
}

onMounted(async () => {
  isDev.value = await window.electronAPI.getDevMode()
  console.log('[App.vue] isDev:', isDev.value)
  window.electronAPI.onShowSettings(() => {
    currentView.value = 'settings'
  })

  // 监听整个文档的鼠标进出，确保 -webkit-app-region: drag 区域也能触发
  document.body.addEventListener('pointerenter', onMouseEnter)
  document.body.addEventListener('pointerleave', onMouseLeave)
})

onUnmounted(() => {
  document.body.removeEventListener('pointerenter', onMouseEnter)
  document.body.removeEventListener('pointerleave', onMouseLeave)
})
</script>

<style scoped>
.dev-banner {
  background: #ff9800;
  color: #fff;
  text-align: center;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 2px;
  padding: 2px 0;
  user-select: none;
}
</style>
