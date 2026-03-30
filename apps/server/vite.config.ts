import { defineConfig } from 'vite'
import devServer from '@hono/vite-dev-server'

export default defineConfig({
  server: {
    port: 3100,
  },
  plugins: [
    devServer({
      entry: 'src/index.ts',
    }),
  ],
  ssr: {
    external: [
      'pino',
      'pino-pretty',
      'pdf-parse',
      'adm-zip',
      'better-sqlite3',
      '@prisma/client',
      '@prisma/adapter-better-sqlite3',
      'googleapis',
      '@google/genai',
      'node-cron',
    ],
  },
})
