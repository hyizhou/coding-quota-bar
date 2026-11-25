<!--
  服务商图标：providerKey 映射到官方图标资源（来源见 assets/providers/README.md）；
  未登记的 key 不渲染图标，名称照常显示。
-->
<template>
  <img
    v-if="src"
    class="provider-logo"
    :class="{ 'is-mono': MONO_KEYS.has(providerKey) }"
    :src="src"
    :style="{ width: `${size}px`, height: `${size}px` }"
    alt=""
    draggable="false"
  />
</template>

<script setup lang="ts">
import { computed } from 'vue'
import zhipuLogo from '@/renderer/src/assets/providers/zhipu.png'
import minimaxLogo from '@/renderer/src/assets/providers/minimax.svg'
import deepseekLogo from '@/renderer/src/assets/providers/deepseek.svg'
import mimoLogo from '@/renderer/src/assets/providers/mimo.png'
import opencodeGoLogo from '@/renderer/src/assets/providers/opencode-go.png'
import codexLogo from '@/renderer/src/assets/providers/codex.png'
import openrouterLogo from '@/renderer/src/assets/providers/openrouter.svg'
import qoderLogo from '@/renderer/src/assets/providers/qoder.png'
import stepfunLogo from '@/renderer/src/assets/providers/stepfun.png'
import qwenLogo from '@/renderer/src/assets/providers/qwen.svg'

const props = withDefaults(defineProps<{ providerKey: string; size?: number }>(), { size: 20 })

/** provider key → 图标资源；新增服务商时在此登记 */
const LOGOS: Record<string, string> = {
  zhipu: zhipuLogo,
  minimax: minimaxLogo,
  deepseek: deepseekLogo,
  mimo: mimoLogo,
  'opencode-go': opencodeGoLogo,
  codex: codexLogo,
  openrouter: openrouterLogo,
  qoder: qoderLogo,
  stepfun: stepfunLogo,
  qwen: qwenLogo,
}

/** 无底色的黑色字形图标：暗色主题下需反色，否则与卡片背景融为一体 */
const MONO_KEYS = new Set(['minimax', 'deepseek', 'openrouter', 'qwen'])

const src = computed(() => LOGOS[props.providerKey])
</script>

<style scoped>
.provider-logo {
  flex-shrink: 0;
  object-fit: contain;
  border-radius: 4px;
}

/* <img> 引入的 SVG 无法继承文字颜色，暗色下用反色滤镜把黑色字形变白 */
html.dark .provider-logo.is-mono {
  filter: invert(1);
}
</style>
