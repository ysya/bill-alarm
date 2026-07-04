import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
    },
  },
  test: {
    environment: 'node',
    // DB 相關測試共用同一個 SQLite 檔，避免平行寫入衝突
    fileParallelism: false,
  },
})
