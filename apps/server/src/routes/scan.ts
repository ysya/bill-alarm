import { Hono, type Context } from 'hono'
import { streamSSE } from 'hono/streaming'
import { scanEvents, eventVisibleTo, type ScanEvent } from '@/services/scan-events.js'
import prisma from '@/prisma.js'
import {
  runScanWithLog, appendScanLogErrors, publicScanError, retryTargetFor, ScanInProgressError,
  type ScanError, type LoggedScanError, type RetryTarget,
} from '@/services/email-parser.js'
import { processNewBill } from '@/services/notification.js'
import { getAuthUser } from './auth.js'

const app = new Hono()

async function currentUser(c: Context) {
  return prisma.user.findUnique({ where: { id: getAuthUser(c).id } })
}

async function manualScan(c: Context, target?: RetryTarget) {
  const me = await currentUser(c)
  if (!me) return c.json({ error: 'unauthorized' }, 401)
  try {
    const { result, scanLogId } = await runScanWithLog(target ?? 'manual', me)

    // Send notifications for new bills
    const notifyErrors: ScanError[] = []
    for (const { bill, bank, warning } of result.newBills) {
      try {
        await processNewBill(bill, bank, warning)
      } catch (e) {
        notifyErrors.push({
          stage: 'notification',
          bank: bank.name,
          reason: `通知發送失敗：${(e as Error).message}`,
        })
      }
    }
    if (notifyErrors.length > 0) {
      await appendScanLogErrors(scanLogId, notifyErrors)
    }

    return c.json({
      scanLogId,
      scanned: result.scanned,
      newBills: result.newBills.length,
      errors: [...result.errors, ...notifyErrors].map(publicScanError),
      skipReason: result.skipReason,
    })
  } catch (e) {
    if (e instanceof ScanInProgressError) {
      return c.json({ error: '掃描進行中，請稍候' }, 409)
    }
    return c.json({
      error: (e as Error).message,
      scanned: 0,
      newBills: 0,
      errors: [{ stage: 'unexpected', reason: (e as Error).message }],
    }, 500)
  }
}

app.post('/email/scan', (c) => manualScan(c))

app.post('/scan-logs/:id/errors/:index/retry', async (c) => {
  const index = c.req.param('index')
  if (!/^(0|[1-9]\d*)$/.test(index)) return c.json({ error: '無效的錯誤紀錄' }, 400)
  const log = await prisma.scanLog.findFirst({
    where: { id: c.req.param('id'), userId: getAuthUser(c).id },
    select: { errors: true },
  })
  const errors: LoggedScanError[] = log?.errors ? JSON.parse(log.errors) : []
  const error = errors[Number(index)]
  if (!error) return c.json({ error: '找不到錯誤紀錄' }, 404)
  const target = retryTargetFor(error)
  if (!target) return c.json({ error: '此紀錄無法單封重試' }, 422)
  return manualScan(c, target)
})

// Live scan progress via Server-Sent Events.
// Stays open and forwards events emitted from runScanWithLog().
app.get('/scan-events', (c) => {
  const me = getAuthUser(c)
  // Disable response buffering on this SSE stream so progress events reach
  // the client immediately instead of sitting in an nginx/proxy buffer until
  // it fills up or the connection closes. Nginx also needs a matching
  // `proxy_buffering off` location block (see nginx.conf) — this header alone
  // isn't sufficient behind a reverse proxy.
  c.header('X-Accel-Buffering', 'no')
  return streamSSE(c, async (stream) => {
    let resolveDone: () => void = () => {}
    const done = new Promise<void>((r) => { resolveDone = r })

    const listener = (event: ScanEvent) => {
      if (!eventVisibleTo(event, me.id)) return
      stream
        .writeSSE({ event: event.type, data: JSON.stringify(event) })
        .catch(() => { /* client disconnected mid-write */ })
    }
    scanEvents.on('scan', listener)

    stream.onAbort(() => {
      scanEvents.off('scan', listener)
      resolveDone()
    })

    // Initial hello so EventSource considers the stream open.
    await stream.writeSSE({ event: 'hello', data: '{}' })

    // If a scan is in progress right now, replay the latest known state
    // so a freshly-connected client (e.g. after page refresh) catches up
    // instead of waiting for the next event. getSnapshot is already scoped
    // to this user, so no extra visibility check is needed here.
    const snapshot = scanEvents.getSnapshot(me.id)
    if (snapshot) {
      await stream.writeSSE({ event: 'start', data: JSON.stringify(snapshot.start) })
      if (snapshot.progress) {
        await stream.writeSSE({ event: 'progress', data: JSON.stringify(snapshot.progress) })
      }
    }

    // Heartbeat every 30s to keep proxies / Nuxt devProxy happy.
    const heartbeat = setInterval(() => {
      stream.writeSSE({ event: 'ping', data: '{}' }).catch(() => {})
    }, 30_000)

    try {
      await done
    } finally {
      clearInterval(heartbeat)
    }
  })
})

// Recent scan logs (most recent first)
app.get('/scan-logs', async (c) => {
  const limit = Math.min(Math.max(parseInt(c.req.query('limit') ?? '20'), 1), 100)
  const userId = getAuthUser(c).id
  const logs = await prisma.scanLog.findMany({
    where: { userId },
    orderBy: { startedAt: 'desc' },
    take: limit,
  })
  const rows = logs.map(log => ({ ...log, errors: log.errors ? JSON.parse(log.errors) as LoggedScanError[] : [] }))
  const legacyNames = rows.flatMap(log => log.errors.flatMap(error =>
    error.stage === 'pdf_password' && !error.bankId && error.bank ? [error.bank] : [],
  ))
  const candidates = legacyNames.length
    ? await prisma.bank.findMany({
        where: { userId, name: { in: [...new Set(legacyNames)] } },
        select: { id: true, name: true, createdAt: true },
      })
    : []
  return c.json({
    logs: rows.map((l) => ({
      id: l.id,
      trigger: l.trigger,
      startedAt: l.startedAt.toISOString(),
      finishedAt: l.finishedAt?.toISOString() ?? null,
      scanned: l.scanned,
      newBillsCount: l.newBillsCount,
      errorCount: l.errorCount,
      errors: l.errors.map(error => {
        const dto = publicScanError(error)
        if (dto.stage === 'pdf_password' && !dto.bankId && dto.bank) {
          const matches = candidates.filter(bank => bank.name === dto.bank && bank.createdAt <= l.startedAt)
          if (matches.length === 1) dto.bankId = matches[0].id
        }
        return dto
      }),
      fatalError: l.fatalError,
    })),
  })
})

export default app
