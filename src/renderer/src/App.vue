<template>
  <div class="app">
    <Transition :name="transitionName">
      <MainView v-if="currentView === 'main'" key="main" @open-settings="goSettings" />
      <SettingsView v-else :key="'settings-' + settingsKey" :auto-check-update="pendingCheckUpdate" @go-back="goMain" />
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import MainView from './views/MainView.vue'
import SettingsView from './views/SettingsView.vue'

const { locale } = useI18n()

const currentView = ref<'main' | 'settings'>('main')
const transitionName = ref('slide-left')
const pendingCheckUpdate = ref(false)
const settingsKey = ref(0)

function goSettings(options?: { checkUpdate?: boolean }) {
  transitionName.value = 'slide-left'
  pendingCheckUpdate.value = !!options?.checkUpdate
  if (options?.checkUpdate && currentView.value === 'settings') {
    // 已在设置页，强制重新挂载以触发 onMounted
    settingsKey.value++
  }
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
  // 从保存的配置中恢复语言设置
  const config = await window.electronAPI.getConfig()
  if (config?.language) {
    locale.value = config.language
  }
  window.electronAPI.onShowSettings((options) => {
    goSettings(options)
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
