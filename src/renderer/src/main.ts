import { createApp } from 'vue'
import App from './App.vue'
import i18n from './locales'
import './styles/colors.css'
import './styles/reduced-motion.css'
import '../style.css'

/**
 * 全局错误捕获：上报到主进程写 log 文件
 * - window.onerror: 同步错误
 * - unhandledrejection: Promise 未捕获
 * - console.error: 拦截 console.error 同样上报（避免错误只在控制台看不见）
 */
function reportError(message: string, stack?: string, source = 'window') {
  try {
    window.electronAPI?.reportRendererError?.({ message, stack, source })
  } catch (e) {
    // 主进程也挂了——只能 console
    console.error('[renderer-error] main process not available:', e)
  }
}

window.addEventListener('error', (e) => {
  reportError(e.message || String(e.error), e.error?.stack, 'window.error')
})

window.addEventListener('unhandledrejection', (e) => {
  const reason = e.reason
  const message = reason instanceof Error ? reason.message : String(reason)
  const stack = reason instanceof Error ? reason.stack : undefined
  reportError(message, stack, 'unhandledrejection')
})

// 拦截 console.error 让"控制台看到的错误"也能进 log
const originalConsoleError = console.error
console.error = (...args: unknown[]) => {
  const message = args.map(a => a instanceof Error ? a.message : String(a)).join(' ')
  const stack = args.find(a => a instanceof Error)?.stack
  reportError(message, stack, 'console.error')
  originalConsoleError.apply(console, args)
}

createApp(App).use(i18n).mount('#app')
