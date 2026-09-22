<!--
  通用复制按钮：点击将传入文本写入剪贴板，短暂显示"已复制"反馈。
  clipboard API 优先，file:// 等非安全上下文回退 execCommand。
-->
<template>
  <button class="copy-btn" @click="copy">
    {{ copied ? t('main.errorCopied') : t('main.copyErrorBtn') }}
  </button>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  /** 要复制的完整原文（调用方自行拼接 provider/账号标识与错误码） */
  text: string
}>()

const { t } = useI18n()

/** 复制反馈（短暂显示"已复制"后还原） */
const copied = ref(false)
let timer: ReturnType<typeof setTimeout> | undefined

async function copy(): Promise<void> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(props.text)
    } else {
      throw new Error('clipboard api unavailable')
    }
  } catch {
    // file:// 等非安全上下文回退：临时 textarea + execCommand
    const textarea = document.createElement('textarea')
    textarea.value = props.text
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    document.execCommand('copy')
    textarea.remove()
  }
  copied.value = true
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => { copied.value = false }, 1500)
}
</script>

<style scoped>
.copy-btn {
  flex-shrink: 0;
  font-size: 11px;
  padding: 2px 8px;
  margin-left: 6px;
  border: 1px solid var(--border-subtle);
  border-radius: 4px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
}

.copy-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}
</style>
