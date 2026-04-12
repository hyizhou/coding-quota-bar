<template>
  <div class="app">
    <div v-if="isDev" class="dev-banner">DEV</div>
    <Transition :name="transitionName">
      <MainView v-if="currentView === 'main'" key="main" @open-settings="goSettings" />
      <SettingsView v-else key="settings" @go-back="goMain" />
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import MainView from './views/MainView.vue'
import SettingsView from './views/SettingsView.vue'

const currentView = ref<'main' | 'settings'>('main')
const transitionName = ref('slide-left')
const isDev = ref(false)

function goSettings() {
  transitionName.value = 'slide-left'
  currentView.value = 'settings'
}

function goMain() {
  transitionName.value = 'slide-right'
  currentView.value = 'main'
}

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
    goSettings()
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

.slide-left-enter-active,
.slide-left-leave-active,
.slide-right-enter-active,
.slide-right-leave-active {
  transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  position: absolute;
  width: 100%;
}

.slide-left-enter-from {
  transform: translateX(100%);
}

.slide-left-leave-to {
  transform: translateX(-100%);
}

.slide-right-enter-from {
  transform: translateX(-100%);
}

.slide-right-leave-to {
  transform: translateX(100%);
}
</style>
