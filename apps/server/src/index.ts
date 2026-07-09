import 'dotenv/config'

// Bare-metal fallback; Docker sets this via ENV. ??= keeps explicit TZ (incl. test matrices).
process.env.TZ ??= 'Asia/Taipei'

import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import pino from 'pino'
import { pinoLogger } from 'hono-pino'
import bankRoutes from './routes/banks.js'
import bankAccountRoutes from './routes/bank-accounts.js'
import billRoutes from './routes/bills.js'
import notificationRulesRoutes from './routes/notification-rules.js'
import scanRoutes from './routes/scan.js'
import parserLabRoutes from './routes/parser-lab.js'
import llmRoutes from './routes/llm.js'
import integrationsRoutes from './routes/integrations.js'
import configRoutes from './routes/config.js'
import emailRoutes from './routes/email.js'
import calendarFeedRoutes from './routes/calendar-feed.js'
import authRoutes, { authGuard } from './routes/auth.js'
import userRoutes from './routes/users.js'
import { startScheduler } from './services/scheduler.js'

const isDev = process.env.NODE_ENV !== 'production'

export const logger = pino({
  level: process.env.LOG_LEVEL || (isDev ? 'debug' : 'info'),
  // Session cookies must never reach log output, even if the pretty-print
  // ignore list changes — redact at the pino level.
  redact: {
    paths: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]'],
    censor: '[redacted]',
  },
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

// hono-pino@0.10.3's onResMessage only ever receives `c` (confirmed against
// node_modules/hono-pino/dist/index.d.ts + dist/index.js — it calls
// `opts.http.onResMessage(c)`, no 2nd/3rd arg). The previous 3-arg
// `(c, _logger, rt)` signature never matched that, so `rt` was always
// `undefined` and the "NNms" suffix never actually appeared. Track our own
// start time so the intended "METHOD /path STATUS NNms" format works.
const requestStartTimes = new WeakMap<Request, number>()
app.use(async (c, next) => {
  requestStartTimes.set(c.req.raw, performance.now())
  await next()
})

app.use(pinoLogger({
  pino: logger,
  http: {
    onResMessage: (c) => {
      const start = requestStartTimes.get(c.req.raw)
      const rt = start != null ? Math.round(performance.now() - start) : null
      return `${c.req.method} ${c.req.path} ${c.res.status}${rt != null ? ` ${rt}ms` : ''}`
    },
    // `reqId` is typed `false | (() => string)` — `false` genuinely disables it.
    // The old `() => undefined as unknown as string` cast didn't actually suppress
    // anything at runtime: hono-pino does `reqId?.() ?? autoIncrement()`, so an
    // `undefined` return still fell through to the auto-incrementing id. It only
    // ever *looked* suppressed because pino-pretty's `ignore: '...,reqId,...'`
    // (below) hides the field from output either way.
    reqId: false,
  },
}))

// Any error thrown by a route or middleware below is caught here — log full
// detail server-side via pino, never leak internals (message/stack) to the
// client.
app.onError((err, c) => {
  logger.error({ err: err.message, stack: err.stack, path: c.req.path }, 'Unhandled route error')
  return c.json({ error: '伺服器內部錯誤' }, 500)
})

// Same-origin deploy + cookie auth: no cross-origin caller is ever legitimate,
// so cors() was a no-op that only risked loosening credential-less reads.
// Cap request bodies for all API routes; auth's own stricter 16KB limit
// (mounted inside its sub-app) still applies on top of this for /api/auth/*.
app.use('/api/*', bodyLimit({ maxSize: 25 * 1024 * 1024, onError: (c) => c.json({ error: '請求內容過大' }, 413) }))
app.use('/api/*', authGuard)

// API routes
app.get('/api/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }))
app.route('/api/auth', authRoutes)
app.route('/api/users', userRoutes)
app.route('/api/banks', bankRoutes)
app.route('/api/bank-accounts', bankAccountRoutes)
app.route('/api/bills', billRoutes)
app.route('/api/notification-rules', notificationRulesRoutes)
app.route('/api', scanRoutes)
app.route('/api', parserLabRoutes)
app.route('/api', llmRoutes)
app.route('/api', integrationsRoutes)
app.route('/api/config', configRoutes)
app.route('/api/email', emailRoutes)
app.route('/api/calendar', calendarFeedRoutes)

// Start scheduler (skipped under vitest — importing the app must not start cron)
if (!process.env.VITEST) startScheduler()

// Vite dev server uses this export; production uses serve.ts
export default app
