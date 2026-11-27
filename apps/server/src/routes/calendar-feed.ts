import { Hono } from 'hono'
import { createEvents, type EventAttributes, type Alarm } from 'ics'
import prisma from '@/prisma.js'
import { billDetailUrl, getSetting, KEYS } from '@/services/settings.js'
import { DEFAULT_PREFS, POST_DUE_NOTIFY_HOUR } from '@/services/notification-prefs.js'
import { BillStatus, fundingRemaining, isAwaitingDebit, statusLabel } from '@bill-alarm/shared/types'
import { addDaysYMD } from '@bill-alarm/shared/date'
import { formatAmount } from '@bill-alarm/shared/format'
import { getAuthUser } from './auth.js'

const app = new Hono()

function dateToArray(ymd: string): [number, number, number] {
  const [y, m, d] = ymd.split('-').map(Number)
  return [y, m, d]
}

function newFeedToken(): string {
  return crypto.randomUUID().replace(/-/g, '')
}

async function feedResponse(c: Parameters<typeof getAuthUser>[0], token: string) {
  const baseUrl = (await getSetting(KEYS.APP_BASE_URL)) || ''
  const path = `/api/calendar/feed/${token}.ics`
  return c.json({ token, feedUrl: baseUrl ? `${baseUrl}${path}` : path, feedPath: path })
}

// GET /feed/:token.ics — public; the personal token gates access
app.get('/feed/:token{[^/]+\\.ics}', async (c) => {
  const token = c.req.param('token').replace(/\.ics$/, '')
  const owner = await prisma.user.findFirst({
    where: { icsFeedToken: token, deletedAt: null },
    select: { id: true, notificationPreference: { select: { notifyDebitConfirmation: true } } },
  })
  if (!owner) return c.text('Not Found', 404)

  const bills = await prisma.bill.findMany({
    where: {
      status: { in: [BillStatus.PENDING, BillStatus.OVERDUE] },
      bank: { userId: owner.id },
    },
    include: { bank: true },
    orderBy: { dueDate: 'asc' },
  })

  const prefs = owner.notificationPreference ?? DEFAULT_PREFS
  const baseUrl = await getSetting(KEYS.APP_BASE_URL)
  const events: EventAttributes[] = bills.map((bill) => {
    const awaitingDebit = isAwaitingDebit(bill)
    const nextDay = dateToArray(addDaysYMD(bill.dueDate, 1))
    let label = statusLabel(bill.status)
    let reminder = '帳單到期'
    let alarms: Alarm[]
    if (awaitingDebit) {
      label = '已備足款項，待確認扣款'
      alarms = prefs.notifyDebitConfirmation
        ? [{ action: 'display', description: '請核對銀行紀錄後確認扣款', trigger: [...nextDay, POST_DUE_NOTIFY_HOUR, 0] }]
        : []
    } else {
      if (bill.transferredAt) {
        reminder = `尚需備款 ${formatAmount(fundingRemaining(bill))}`
        label += `，${reminder}`
      }
      alarms = [
        { action: 'display', description: `${reminder}（明天）`, trigger: { hours: 24, before: true } },
        { action: 'display', description: `${reminder}（1 小時前）`, trigger: { hours: 1, before: true } },
      ]
    }
    return {
      uid: `bill-${bill.id}@bill-alarm`,
      title: `💳 ${bill.bank.name} ${formatAmount(bill.amount)}${bill.transferredAt ? ` ・ ${label}` : ''}`,
      description: [
        `銀行：${bill.bank.name}`,
        `應繳金額：${formatAmount(bill.amount)}`,
        bill.minimumPayment != null ? `最低應繳：${formatAmount(bill.minimumPayment)}` : '',
        `帳單月份：${bill.billingPeriod}`,
        `狀態：${label}`,
        billDetailUrl(baseUrl, bill.id) ?? `帳單明細：/bills/${bill.id}`,
      ].filter(Boolean).join('\n'),
      start: dateToArray(bill.dueDate),
      end: nextDay,
      productId: 'bill-alarm/ics',
      calName: 'Bill Alarm',
      alarms,
    }
  })

  const { error, value } = createEvents(events)
  if (error || !value) {
    return c.text(`ICS generation failed: ${error?.message ?? 'unknown'}`, 500)
  }

  c.header('Content-Type', 'text/calendar; charset=utf-8')
  c.header('Cache-Control', 'no-cache')
  return c.body(value)
})

app.get('/info', async (c) => {
  const me = await prisma.user.findUnique({ where: { id: getAuthUser(c).id } })
  if (!me) return c.json({ error: 'unauthorized' }, 401)
  let token = me.icsFeedToken
  if (!token) {
    token = newFeedToken()
    await prisma.user.update({ where: { id: me.id }, data: { icsFeedToken: token } })
  }
  return feedResponse(c, token)
})

app.post('/rotate', async (c) => {
  const token = newFeedToken()
  await prisma.user.update({ where: { id: getAuthUser(c).id }, data: { icsFeedToken: token } })
  return feedResponse(c, token)
})

export default app
