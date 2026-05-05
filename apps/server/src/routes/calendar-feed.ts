import { Hono } from 'hono'
import { createEvents, type EventAttributes, type DateArray } from 'ics'
import prisma from '@/prisma.js'
import { getSetting, KEYS, getOrCreateIcsFeedToken, rotateIcsFeedToken } from '@/services/settings.js'
import { BillStatus } from '@bill-alarm/shared/types'

const app = new Hono()

function formatAmount(amount: number): string {
  return `NT$ ${amount.toLocaleString('zh-TW')}`
}

function dateToArray(d: Date): DateArray {
  return [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()]
}

// GET /:token.ics — public ICS feed; token gates access
app.get('/feed/:token{[^/]+\\.ics}', async (c) => {
  const param = c.req.param('token')
  const token = param.replace(/\.ics$/, '')

  const expected = await getSetting(KEYS.ICS_FEED_TOKEN)
  if (!expected || expected !== token) {
    return c.text('Not Found', 404)
  }

  const bills = await prisma.bill.findMany({
    where: { status: { in: [BillStatus.PENDING, BillStatus.OVERDUE] } },
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

// Authenticated endpoints (under /api/calendar)
app.get('/info', async (c) => {
  const token = await getOrCreateIcsFeedToken()
  const baseUrl = (await getSetting(KEYS.APP_BASE_URL)) || ''
  const path = `/api/calendar/feed/${token}.ics`
  return c.json({
    token,
    feedUrl: baseUrl ? `${baseUrl}${path}` : path,
    feedPath: path,
  })
})

app.post('/rotate', async (c) => {
  const token = await rotateIcsFeedToken()
  const baseUrl = (await getSetting(KEYS.APP_BASE_URL)) || ''
  const path = `/api/calendar/feed/${token}.ics`
  return c.json({ token, feedUrl: baseUrl ? `${baseUrl}${path}` : path, feedPath: path })
})

export default app
