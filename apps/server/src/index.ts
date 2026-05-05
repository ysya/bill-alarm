import 'dotenv/config'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import pino from 'pino'
import { pinoLogger } from 'hono-pino'
import bankRoutes from './routes/banks.js'
import bankAccountRoutes from './routes/bank-accounts.js'
import billRoutes from './routes/bills.js'
import settingsRoutes from './routes/settings.js'
import systemRoutes from './routes/system.js'
import configRoutes from './routes/config.js'
import emailRoutes from './routes/email.js'
import calendarFeedRoutes from './routes/calendar-feed.js'
import { startScheduler } from './services/scheduler.js'

const isDev = process.env.NODE_ENV !== 'production'

export const logger = pino({
  level: process.env.LOG_LEVEL || (isDev ? 'debug' : 'info'),
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: isDev,
      ignore: 'pid,hostname,req,res,reqId,responseTime',
      translateTime: 'HH:MM:ss',
    },
  },
})

const app = new Hono()

app.use(pinoLogger({
  pino: logger,
  http: {
    onResMessage: (c, _logger, rt) => `${c.req.method} ${c.req.path} ${c.res.status}${rt != null ? ` ${rt}ms` : ''}`,
    reqId: () => undefined as unknown as string,
  },
}))
app.use('/api/*', cors())

// API routes
app.get('/api/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }))
app.route('/api/banks', bankRoutes)
app.route('/api/bank-accounts', bankAccountRoutes)
app.route('/api/bills', billRoutes)
app.route('/api/notification-rules', settingsRoutes)
app.route('/api', systemRoutes)
app.route('/api/config', configRoutes)
app.route('/api/email', emailRoutes)
app.route('/api/calendar', calendarFeedRoutes)

// Start scheduler
startScheduler()

// Vite dev server uses this export; production uses serve.ts
export default app
