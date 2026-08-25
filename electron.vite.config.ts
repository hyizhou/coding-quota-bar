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
          // chart.js 拆为独立懒加载 chunk；注意不能把 vue-chartjs 一并划入，
          // 它静态依赖 Vue，会连 Vue 一起吸进该 chunk，导致首屏被迫加载
          manualChunks: (id) => {
            if (id.includes('node_modules/chart.js/')) {
              return 'chart-lib'
            }
          }
        }
      }
    }
  }
})
