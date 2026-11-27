import { describe, it, expect, vi, afterEach } from 'vitest'
import { setupTestDb } from '../../services/__tests__/helpers/test-db.js'
import { todayYMD, addDaysYMD } from '@bill-alarm/shared/date'
import { formatAmount } from '@bill-alarm/shared/format'

setupTestDb()
process.env.LOG_LEVEL = 'silent'

const { default: app } = await import('@/index.js')
const { default: prisma } = await import('@/prisma.js')
const { hashPassword } = await import('@/services/auth.js')

function cookieOf(res: Response): string {
  return res.headers.get('set-cookie')?.split(';')[0] ?? ''
}

const setup = await app.request('/api/auth/setup', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'boss', password: 'admin-password' }),
})
const boss = cookieOf(setup)
const kidRow = await prisma.user.create({
  data: { username: 'kid', passwordHash: await hashPassword('member-password'), role: 'member' },
})
const kidLogin = await app.request('/api/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'kid', password: 'member-password' }),
})
const kid = cookieOf(kidLogin)

afterEach(() => vi.unstubAllEnvs())

describe('per-user calendar feed', () => {
  it('info creates a personal token; feeds are disjoint; rotate only changes your own', async () => {
    const bossInfo = await (await app.request('/api/calendar/info', { headers: { Cookie: boss } })).json()
    const kidInfo = await (await app.request('/api/calendar/info', { headers: { Cookie: kid } })).json()
    expect(bossInfo.token).toBeTruthy()
    expect(kidInfo.token).toBeTruthy()
    expect(bossInfo.token).not.toBe(kidInfo.token)

    const bossUser = await prisma.user.findUnique({ where: { username: 'boss' } })
    const bossBank = await prisma.bank.create({
      data: { name: 'BossBank', emailSenderPattern: 'x@x', emailSubjectPattern: 'b', userId: bossUser!.id },
    })
    await prisma.bill.create({
      data: { bankId: bossBank.id, billingPeriod: '2026-07', amount: 500, dueDate: addDaysYMD(todayYMD(), 1) },
    })

    const bossFeed = await app.request(`/api/calendar/feed/${bossInfo.token}.ics`)
    expect(bossFeed.status).toBe(200)
    expect(await bossFeed.text()).toContain('BossBank')

    const kidFeed = await app.request(`/api/calendar/feed/${kidInfo.token}.ics`)
    expect(kidFeed.status).toBe(200)
    expect(await kidFeed.text()).not.toContain('BossBank')

    const rotated = await (await app.request('/api/calendar/rotate', { method: 'POST', headers: { Cookie: kid } })).json()
    expect(rotated.token).not.toBe(kidInfo.token)
    expect((await app.request(`/api/calendar/feed/${kidInfo.token}.ics`)).status).toBe(404)
    expect((await app.request(`/api/calendar/feed/${bossInfo.token}.ics`)).status).toBe(200)
  })

  it('publishes a confirmation alarm only for opted-in funded bills, preserving shortfall reminders and removing settled bills', async () => {
    const user = await prisma.user.create({ data: { username: 'calendar-owner', passwordHash: 'x:y', icsFeedToken: 'calendar-owner-token' } })
    const bank = await prisma.bank.create({ data: { name: 'CalendarBank', emailSenderPattern: 'x@x', emailSubjectPattern: 'b', userId: user.id, autoDebit: true } })
    const bill = await prisma.bill.create({
      data: { bankId: bank.id, billingPeriod: '2026-12', dueDate: '2026-12-31', amount: 500, transferredAt: new Date(), transferredAmount: 500 },
    })
    async function feed() {
      const res = await app.request(`/api/calendar/feed/${user.icsFeedToken}.ics`)
      expect(res.status).toBe(200)
      return (await res.text()).replace(/\r\n[ \t]/g, '')
    }
    vi.stubEnv('APP_BASE_URL', '')
    const silent = await feed()
    expect(silent).toContain(`UID:bill-${bill.id}@bill-alarm`)
    expect(silent).toContain('待確認扣款')
    expect(silent).toContain(`帳單明細：/bills/${bill.id}`)
    expect(silent).not.toContain('http://localhost')
    expect(silent).not.toContain('BEGIN:VALARM')

    await prisma.notificationPreference.create({ data: { userId: user.id, notifyDebitConfirmation: true } })
    vi.stubEnv('APP_BASE_URL', 'https://bills.example.org:8443/')
    const reminder = await feed()
    expect(reminder).toContain(`https://bills.example.org:8443/bills/${bill.id}`)
    expect(reminder.match(/BEGIN:VALARM/g)).toHaveLength(1)
    const nextMorning = new Date(2027, 0, 1, 9).toISOString().replace(/[-:]/g, '').replace('.000', '')
    expect(reminder).toContain(`TRIGGER;VALUE=DATE-TIME:${nextMorning}`)
    expect(reminder).toContain('請核對銀行紀錄後確認扣款')

    await prisma.bill.update({ where: { id: bill.id }, data: { amount: 570 } })
    const partial = await feed()
    expect(partial.match(/BEGIN:VALARM/g)).toHaveLength(2)
    expect(partial).toContain(`尚需備款 ${formatAmount(70)}`)
    expect(partial).not.toContain('待確認扣款')

    await prisma.bill.update({ where: { id: bill.id }, data: { status: 'paid' } })
    expect(await feed()).not.toContain(bill.id)
  })

  it("deactivated user's token is dead", async () => {
    const info = await (await app.request('/api/calendar/info', { headers: { Cookie: kid } })).json()
    await prisma.user.update({ where: { id: kidRow.id }, data: { deletedAt: new Date() } })
    expect((await app.request(`/api/calendar/feed/${info.token}.ics`)).status).toBe(404)
  })
})
