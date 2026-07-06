import { Hono } from 'hono'
import { createEvents, type EventAttributes, type DateArray } from 'ics'
import prisma from '@/prisma.js'
import { getSetting, KEYS } from '@/services/settings.js'
import { BillStatus } from '@bill-alarm/shared/types'
import { getAuthUser } from './auth.js'

const app = new Hono()

function formatAmount(amount: number): string {
  return `NT$ ${amount.toLocaleString('zh-TW')}`
}

function dateToArray(d: Date): DateArray {
  return [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()]
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
  const owner = await prisma.user.findFirst({ where: { icsFeedToken: token, deletedAt: null } })
  if (!owner) return c.text('Not Found', 404)

  const bills = await prisma.bill.findMany({
    where: {
      status: { in: [BillStatus.PENDING, BillStatus.OVERDUE] },
      bank: { userId: owner.id },
    },
    include: { bank: true },
    orderBy: { dueDate: 'asc' },
  })

  const events: EventAttributes[] = bills.map((bill) => ({
    uid: `bill-${bill.id}@bill-alarm`,
    title: `💳 ${bill.bank.name} ${formatAmount(bill.amount)}`,
    description: [
      `銀行：${bill.bank.name}`,
      `應繳金額：${formatAmount(bill.amount)}`,
      bill.minimumPayment != null ? `最低應繳：${formatAmount(bill.minimumPayment)}` : '',
      `帳單月份：${bill.billingPeriod}`,
      `狀態：${bill.status}`,
    ].filter(Boolean).join('\n'),
    start: dateToArray(bill.dueDate),
    end: dateToArray(bill.dueDate),
    productId: 'bill-alarm/ics',
    calName: 'Bill Alarm',
    alarms: [
      { action: 'display', description: '帳單到期日（明天）', trigger: { days: 1, before: true } },
      { action: 'display', description: '帳單到期日（1 小時前）', trigger: { hours: 1, before: true } },
    ],
  }))

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
