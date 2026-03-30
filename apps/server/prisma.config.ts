import 'dotenv/config'
import { defineConfig } from 'prisma/config'

export default defineConfig({
  schema: 'src/db/schema.prisma',
  migrate: {
    migrations: 'src/db/migrations',
  },
  datasource: {
    url: process.env.DATABASE_URL ?? 'file:./data/bill-alarm.db',
  },
})
