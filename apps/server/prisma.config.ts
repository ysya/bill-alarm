import path from 'node:path'
import 'dotenv/config'
import { defineConfig } from 'prisma/config'

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
