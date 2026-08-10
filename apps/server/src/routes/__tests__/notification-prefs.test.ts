import { describe, it, expect } from 'vitest'
import { setupTestDb } from '../../services/__tests__/helpers/test-db.js'
import { todayYMD } from '@bill-alarm/shared/date'

setupTestDb()
process.env.LOG_LEVEL = 'silent'

const { default: app } = await import('@/index.js')
const { default: prisma } = await import('@/prisma.js')

function cookieOf(res: Response): string {
  return res.headers.get('set-cookie')?.split(';')[0] ?? ''
}

async function json(method: string, path: string, cookie: string, body?: unknown): Promise<Response> {
  return app.request(path, {
    method,
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

// Bootstrap: admin via /setup, member via users API, both logged in.
const setup = await app.request('/api/auth/setup', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'boss', password: 'admin-password' }),
})
const boss = cookieOf(setup)
await json('POST', '/api/users', boss, { username: 'kid', password: 'member-password' })
const kidLogin = await app.request('/api/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'kid', password: 'member-password' }),
})
const kid = cookieOf(kidLogin)

describe('notification-prefs: GET', () => {
  it('returns defaults and lazy-creates the row', async () => {
    const res = await json('GET', '/api/notification-prefs', boss)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.remindDays).toEqual([3, 1])
    expect(body.remindTime).toBe('09:00')
    expect(body.notifyNewBill).toBe(true)
    expect(body.notifyOverdue).toBe(true)
    expect(body.lastDelivery).toBeNull()

    const bossUser = await prisma.user.findUnique({ where: { username: 'boss' } })
    const row = await prisma.notificationPreference.findUnique({ where: { userId: bossUser!.id } })
    expect(row).not.toBeNull()
    expect(row!.remindDays).toBe('[3,1]')
  })
})

describe('notification-prefs: PUT', () => {
  it('normalizes remindDays (dedupe + sort desc) and persists', async () => {
    const res = await json('PUT', '/api/notification-prefs', boss, {
      remindDays: [1, 3, 3, 7],
      remindTime: '21:30',
      notifyNewBill: false,
      notifyOverdue: true,
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.remindDays).toEqual([7, 3, 1])
    expect(body.remindTime).toBe('21:30')
    expect(body.notifyNewBill).toBe(false)

    const again = await (await json('GET', '/api/notification-prefs', boss)).json()
    expect(again.remindDays).toEqual([7, 3, 1])
    expect(again.notifyNewBill).toBe(false)
  })

  it('accepts an empty remindDays array (reminders off)', async () => {
    const res = await json('PUT', '/api/notification-prefs', boss, {
      remindDays: [],
      remindTime: '09:00',
      notifyNewBill: true,
      notifyOverdue: true,
    })
    expect(res.status).toBe(200)
    expect((await res.json()).remindDays).toEqual([])
  })

  it('rejects out-of-range days, too many entries, and bad time strings', async () => {
    const base = { remindTime: '09:00', notifyNewBill: true, notifyOverdue: true }
    expect((await json('PUT', '/api/notification-prefs', boss, { ...base, remindDays: [31] })).status).toBe(400)
    expect((await json('PUT', '/api/notification-prefs', boss, { ...base, remindDays: [-1] })).status).toBe(400)
    expect((await json('PUT', '/api/notification-prefs', boss, { ...base, remindDays: [1, 2, 3, 4, 5, 6, 7] })).status).toBe(400)
    expect((await json('PUT', '/api/notification-prefs', boss, { remindDays: [3], remindTime: '9:00', notifyNewBill: true, notifyOverdue: true })).status).toBe(400)
    expect((await json('PUT', '/api/notification-prefs', boss, { remindDays: [3], remindTime: '25:61', notifyNewBill: true, notifyOverdue: true })).status).toBe(400)
  })
})

describe('notification-prefs: lastDelivery scoping', () => {
  it("shows only the requester's own latest delivery", async () => {
    const bossUser = await prisma.user.findUnique({ where: { username: 'boss' } })
    const bank = await prisma.bank.create({
      data: { name: 'boss-bank', emailSenderPattern: 'x@x', emailSubjectPattern: 'b', userId: bossUser!.id },
    })
    const bill = await prisma.bill.create({
      data: { bankId: bank.id, billingPeriod: '2026-08', amount: 100, dueDate: todayYMD() },
    })
    await prisma.notificationLog.create({
      data: { billId: bill.id, channel: 'telegram', message: '到期提醒 D-3', success: false, errorMessage: '使用者未綁定 Telegram' },
    })

    const bossBody = await (await json('GET', '/api/notification-prefs', boss)).json()
    expect(bossBody.lastDelivery).not.toBeNull()
    expect(bossBody.lastDelivery.success).toBe(false)
    expect(bossBody.lastDelivery.errorMessage).toBe('使用者未綁定 Telegram')

    const kidBody = await (await json('GET', '/api/notification-prefs', kid)).json()
    expect(kidBody.lastDelivery).toBeNull()
  })
})
