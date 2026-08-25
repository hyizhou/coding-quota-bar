import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    plugins: [vue()],
    server: {
      port: 5174
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
          feedback: resolve(__dirname, 'src/renderer/feedback.html')
        },
        output: {
          // 强制 chart.js / vue-chartjs 拆为独立 chunk，便于 Vite 区分懒加载边界
          manualChunks: (id) => {
            if (id.includes('node_modules/chart.js') || id.includes('node_modules/vue-chartjs')) {
              return 'chart-lib'
            }
          }
        }
      }
    }
  }
})
