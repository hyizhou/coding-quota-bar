<!--
  用量对比趋势箭头：与上期比较，up 红色上升 / down 绿色下降 / flat 不渲染。
-->
<script setup lang="ts">
defineProps<{
  trend: 'up' | 'down' | 'flat'
}>()
</script>

<template>
  <svg
    v-if="trend !== 'flat'"
    class="trend-arrow"
    :class="`trend-${trend}`"
    width="7"
    height="7"
    viewBox="0 0 12 12"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <path v-if="trend === 'up'" d="M6 10V2M2.5 5.5 6 2l3.5 3.5" />
    <path v-else d="M6 2v8M2.5 6.5 6 10l3.5-3.5" />
  </svg>
</template>

<style scoped>
.trend-arrow {
  margin-left: 3px;
}

.trend-up {
  color: #ef4444;
}

.trend-down {
  color: #22c55e;
}
</style>
