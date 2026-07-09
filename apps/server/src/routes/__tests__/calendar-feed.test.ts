import { describe, it, expect } from 'vitest'
import { setupTestDb } from '../../services/__tests__/helpers/test-db.js'
import { todayYMD, addDaysYMD } from '@bill-alarm/shared/date'

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
  data: { username: 'kid', passwordHash: hashPassword('member-password'), role: 'member' },
})
const kidLogin = await app.request('/api/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'kid', password: 'member-password' }),
})
const kid = cookieOf(kidLogin)

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

  it("deactivated user's token is dead", async () => {
    const info = await (await app.request('/api/calendar/info', { headers: { Cookie: kid } })).json()
    await prisma.user.update({ where: { id: kidRow.id }, data: { deletedAt: new Date() } })
    expect((await app.request(`/api/calendar/feed/${info.token}.ics`)).status).toBe(404)
  })
})
