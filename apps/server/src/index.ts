import 'dotenv/config'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import pino from 'pino'
import { pinoLogger } from 'hono-pino'
import bankRoutes from './routes/banks.js'
import billRoutes from './routes/bills.js'
import settingsRoutes from './routes/settings.js'
import systemRoutes from './routes/system.js'
import oauthRoutes from './routes/oauth.js'
import { startScheduler } from './services/scheduler.js'

const isDev = process.env.NODE_ENV !== 'production'

export const logger = pino({
  level: process.env.LOG_LEVEL || (isDev ? 'debug' : 'info'),
  transport: isDev
    ? { target: 'pino-pretty', options: { colorize: true, ignore: 'pid,hostname', translateTime: 'HH:MM:ss' } }
    : undefined,
})

const app = new Hono()

app.use(pinoLogger({ pino: logger }))
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
