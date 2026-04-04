import { createI18n } from 'vue-i18n'
import zhCN from '../../../shared/locales/zh-CN.json'
import enUS from '../../../shared/locales/en-US.json'

function detectLocale(): string {
  const sysLang = navigator.language
  if (sysLang.startsWith('zh')) return 'zh-CN'
  return 'en-US'
}

const i18n = createI18n({
  legacy: false,
  locale: detectLocale(),
  fallbackLocale: 'zh-CN',
  messages: {
    'zh-CN': zhCN,
    'en-US': enUS
  }
})

export default i18n
