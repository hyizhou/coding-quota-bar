// 总览页服务商排序：localStorage 持久化顺序 + HTML5 拖拽按服务商整组重排
import { computed, ref } from 'vue'
import type { ProviderUsageData } from '../../types'
import { buildOverviewCard, type OverviewCard } from './overview-metrics'

export interface OverviewGroup {
  key: string
  cards: OverviewCard[]
}

const STORAGE_KEY_ORDER = 'provider-order'

export function useProviderOrder(providers: () => ProviderUsageData[]) {
  const groupOrder = ref<string[]>(loadSavedOrder())
  const dragKey = ref<string | null>(null)
  const dropTarget = ref<{ key: string; before: boolean } | null>(null)

  /* 服务商级排序：localStorage 保存的顺序优先（未知 key 忽略），未保存的服务商按数据源顺序追加末尾 */
  const groups = computed<OverviewGroup[]>(() => {
    const list = providers()
    const orderedKeys = groupOrder.value.filter(k => list.some(p => p.key === k))
    const orderedProviders = orderedKeys
      .map(k => list.find(p => p.key === k))
      .filter((p): p is ProviderUsageData => !!p)
    const restProviders = list.filter(p => !orderedKeys.includes(p.key))
    return [...orderedProviders, ...restProviders].map(provider => ({
      key: provider.key,
      cards: provider.accounts.map(account => buildOverviewCard(provider, account)),
    }))
  })

  function loadSavedOrder(): string[] {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY_ORDER) ?? '[]')
      return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === 'string') : []
    } catch {
      return []
    }
  }

  function onDragStart(e: DragEvent, key: string): void {
    dragKey.value = key
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move'
      e.dataTransfer.setData('text/plain', key)
    }
  }

  function onDragOver(e: DragEvent, key: string): void {
    if (!dragKey.value || dragKey.value === key) return
    e.preventDefault()
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const before = e.clientY < rect.top + rect.height / 2
    if (dropTarget.value?.key !== key || dropTarget.value.before !== before) {
      dropTarget.value = { key, before }
    }
  }

  function onDrop(e: DragEvent): void {
    e.preventDefault()
    const from = dragKey.value
    const target = dropTarget.value
    if (!from || !target || from === target.key) return
    const keys = groups.value.map(g => g.key).filter(k => k !== from)
    const idx = keys.indexOf(target.key)
    if (idx < 0) return
    keys.splice(target.before ? idx : idx + 1, 0, from)
    groupOrder.value = keys
    try { localStorage.setItem(STORAGE_KEY_ORDER, JSON.stringify(keys)) } catch {}
  }

  function onDragEnd(): void {
    dragKey.value = null
    dropTarget.value = null
  }

  return { groups, dragKey, dropTarget, onDragStart, onDragOver, onDrop, onDragEnd }
}
