import zhCN from '../shared/locales/zh-CN.json'
import enUS from '../shared/locales/en-US.json'

type Messages = typeof zhCN

const messages: Record<string, Messages> = {
  'zh-CN': zhCN,
  'en-US': enUS
}

let currentLocale: string = 'zh-CN'

export function setLocale(locale: string): void {
  if (locale in messages) {
    currentLocale = locale
  }
}

export function getLocale(): string {
  return currentLocale
}

export function t(key: string, params?: Record<string, string | number>): string {
  let result: unknown = messages[currentLocale]
  for (const part of key.split('.')) {
    if (result && typeof result === 'object' && part in result) {
      result = (result as Record<string, unknown>)[part]
    } else {
      return key
    }
  }
  if (typeof result !== 'string') return key
  if (params) {
    return result.replace(/\{(\w+)\}/g, (_, k) => String(params[k] ?? `{${k}}`))
  }
  return result
}
