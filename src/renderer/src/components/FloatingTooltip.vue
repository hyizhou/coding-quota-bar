<script setup lang="ts">
const props = withDefaults(defineProps<{
  rows: Array<{ label: string; value: string }>
  position?: 'top' | 'bottom'
  align?: 'left' | 'center' | 'right'
}>(), {
  position: 'bottom',
  align: 'center',
})
</script>

<template>
  <span class="ft-wrapper">
    <slot />
    <div
      v-if="rows.length"
      class="ft"
      :class="[`ft-${props.position}`, `ft-${props.align}`]"
    >
      <div v-for="(row, i) in rows" :key="i" class="ft-row">
        <span class="ft-label">{{ row.label }}</span>
        <span class="ft-value">{{ row.value }}</span>
      </div>
    </div>
  </span>
</template>

<style scoped>
.ft-wrapper {
  position: relative;
}

/* --- tooltip base --- */
.ft {
  position: absolute;
  background: var(--bg-app);
  backdrop-filter: blur(12px);
  box-shadow: var(--shadow-app);
  color: var(--text-primary);
  border-radius: 8px;
  padding: 8px 12px;
  font-size: 10px;
  z-index: 100;
  pointer-events: none;
  opacity: 0;
  white-space: nowrap;
  transition: opacity 0.15s ease, transform 0.15s ease;
}

.ft-wrapper:hover .ft {
  opacity: 1;
  transform: scale(1);
}

/* --- position: top / bottom --- */
.ft-top {
  bottom: calc(100% + 4px);
  transform: scale(0.9);
}
.ft-bottom {
  top: calc(100% + 4px);
  transform: scale(0.9);
}

/* --- alignment --- */
.ft-left {
  left: 0;
  transform-origin: top left;
}
.ft-top.ft-left {
  transform-origin: bottom left;
}
.ft-center {
  left: 50%;
  transform: translateX(-50%) scale(0.9);
  transform-origin: top center;
}
.ft-top.ft-center {
  transform-origin: bottom center;
}
.ft-wrapper:hover .ft-center {
  transform: translateX(-50%) scale(1);
}
.ft-right {
  right: 0;
  transform-origin: top right;
}
.ft-top.ft-right {
  transform-origin: bottom right;
}

/* --- row layout --- */
.ft-row {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  line-height: 1.6;
}

.ft-label {
  color: var(--text-secondary);
}

.ft-value {
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
</style>
