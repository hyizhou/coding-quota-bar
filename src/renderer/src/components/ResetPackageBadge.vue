<!--
  重置包徽章：展示当前账户可用的 5 小时/周重置包总数，hover 显示分类明细。
-->
<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import FloatingTooltip from './FloatingTooltip.vue'
import type { ResetPackages, ResetPackageSummary } from '../types'

const props = defineProps<{
  resetPackages?: ResetPackages
}>()

const { t, locale } = useI18n()

/** 重置包可用总数（5小时 + 周），无数据返回 0（徽章隐藏） */
function getResetPackageCount(): number {
  const rp = props.resetPackages
  if (!rp) return 0
  return (rp.fiveHour?.count ?? 0) + (rp.week?.count ?? 0)
}

/** 徽章 hover 明细：每类数量一行，有可用卡时附最早到期时间一行 */
function getResetPackageRows(): Array<{ label: string; value: string }> {
  const rp = props.resetPackages
  if (!rp) return []
  const rows: Array<{ label: string; value: string }> = []
  const pushType = (label: string, s: ResetPackageSummary | undefined) => {
    rows.push({ label, value: `×${s?.count ?? 0}` })
    const expire = s?.count ? formatResetExpire(s.earliestExpireAt) : ''
    if (s?.count && expire) rows.push({ label: t('main.resetPackageEarliestExpire'), value: expire })
  }
  pushType(t('main.resetPackageFiveHour'), rp.fiveHour)
  pushType(t('main.resetPackageWeek'), rp.week)
  return rows
}

/** 到期时间格式化：如 "9月7日 23:59"，无效时间返回空串 */
function formatResetExpire(iso: string | undefined): string {
  if (!iso) return ''
  try {
    const d = new Date(iso)
    if (isNaN(d.getTime())) return ''
    const date = d.toLocaleDateString(locale.value, { month: 'short', day: 'numeric' })
    const time = d.toLocaleTimeString(locale.value, { hour: '2-digit', minute: '2-digit', hour12: false })
    return `${date} ${time}`
  } catch { return '' }
}
</script>

<template>
  <FloatingTooltip
    v-if="getResetPackageCount() > 0"
    position="bottom"
    align="right"
    :rows="getResetPackageRows()"
    @mouseenter.stop
    @mouseleave.stop
  >
    <span class="provider-reset-badge">
      <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="20 12 20 22 4 22 4 12" />
        <rect x="2" y="7" width="20" height="5" />
        <line x1="12" y1="22" x2="12" y2="7" />
        <path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z" />
        <path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z" />
      </svg>
      {{ t('main.resetPackageBadge', { n: getResetPackageCount() }) }}
    </span>
  </FloatingTooltip>
</template>

<style scoped>
/* FloatingTooltip 根节点转为 inline-flex，保证不同高度徽章在父级行内垂直居中 */
.ft-wrapper {
  display: inline-flex;
  align-items: center;
  line-height: 1;
}

/* 重置包徽章：胶囊样式 + 礼物盒图标 + 数字等宽 */
.provider-reset-badge {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  font-size: 9px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--reset-badge-text);
  background: var(--reset-badge-bg);
  padding: 1px 5px;
  border-radius: 8px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  white-space: nowrap;
  line-height: 1;
  cursor: default;
}
</style>
