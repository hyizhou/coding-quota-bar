<!--
  总览卡片列表容器：按服务商分组渲染 OverviewCard，接线拖拽排序（useProviderOrder）
  与点击跳转；指标构建与格式化见 overview-metrics.ts。
-->
<template>
  <div class="overview">
    <template v-for="group in groups" :key="group.key">
      <OverviewCard
        v-for="(card, idx) in group.cards"
        :key="`${group.key}:${card.account.id}`"
        :card="card"
        :dragging="dragKey === group.key"
        :drop-above="dropTarget?.key === group.key && dropTarget.before && idx === 0"
        :drop-below="dropTarget?.key === group.key && !dropTarget.before && idx === group.cards.length - 1"
        draggable="true"
        @click="$emit('select-provider', group.key, card.account.id)"
        @dragstart="onDragStart($event, group.key)"
        @dragover="onDragOver($event, group.key)"
        @drop="onDrop"
        @dragend="onDragEnd"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import type { ProviderUsageData } from '../../types'
import OverviewCard from './OverviewCard.vue'
import { useProviderOrder } from './useProviderOrder'

const props = defineProps<{
  providers: ProviderUsageData[]
}>()

defineEmits<{
  'select-provider': [key: string, accountId?: string]
}>()

const { groups, dragKey, dropTarget, onDragStart, onDragOver, onDrop, onDragEnd } = useProviderOrder(() => props.providers)
</script>

<style scoped>
.overview {
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding-bottom: 4px;
}
</style>
