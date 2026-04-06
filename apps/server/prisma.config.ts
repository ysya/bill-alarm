import path from 'node:path'
import { defineConfig } from 'prisma/config'

try { await import('dotenv/config') }
catch {}

const serverRoot = path.resolve(import.meta.dirname)
const dataDir = process.env.DATA_DIR ?? path.join(serverRoot, 'data')

export default defineConfig({
  schema: 'prisma/',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env.DATABASE_URL ?? `file:${path.join(dataDir, 'bill-alarm.db')}`,
  },
})
