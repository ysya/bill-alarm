import 'dotenv/config'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import pino from 'pino'
import pretty from 'pino-pretty'
import bankRoutes from './routes/banks.js'
import billRoutes from './routes/bills.js'
import settingsRoutes from './routes/settings.js'
import systemRoutes from './routes/system.js'
import oauthRoutes from './routes/oauth.js'
import { startScheduler } from './services/scheduler.js'

export const logger = pino(
  { level: process.env.LOG_LEVEL || 'info' },
  process.env.NODE_ENV === 'production'
    ? undefined
    : pretty({ colorize: true, ignore: 'pid,hostname', translateTime: 'HH:MM:ss' }),
)

const app = new Hono()

// Simple request logger
app.use('*', async (c, next) => {
  const start = Date.now()
  await next()
  const ms = Date.now() - start
  logger.info(`${c.req.method} ${c.req.path} ${c.res.status} ${ms}ms`)
})
app.use('/api/*', cors())

// API routes
app.get('/api/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }))
app.route('/api/banks', bankRoutes)
app.route('/api/bills', billRoutes)
app.route('/api/notification-rules', settingsRoutes)
app.route('/api', systemRoutes)
app.route('/api/oauth', oauthRoutes)

// Start scheduler
startScheduler()

// Vite dev server uses this export; production uses serve.ts
export default app
