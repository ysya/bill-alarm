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

const setup = await app.request('/api/auth/setup', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'boss', password: 'admin-password' }),
})
const adminCookie = cookieOf(setup)

async function createUser(username: string, password: string): Promise<Response> {
  return app.request('/api/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
    body: JSON.stringify({ username, password }),
  })
}

describe('users management', () => {
  it('admin creates a member; duplicate username is 409', async () => {
    const res = await createUser('kid', 'member-password')
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.role).toBe('member')
    expect(body.telegramBound).toBe(false)
    expect(body).not.toHaveProperty('passwordHash')

    expect((await createUser('kid', 'member-password')).status).toBe(409)
  })

  it('lists users without password hashes', async () => {
    const res = await app.request('/api/users', { headers: { Cookie: adminCookie } })
    expect(res.status).toBe(200)
    const list = await res.json()
    expect(list.map((u: any) => u.username).sort()).toEqual(['boss', 'kid'])
    expect(list.every((u: any) => !('passwordHash' in u))).toBe(true)
  })

  it('reset password revokes the target user sessions', async () => {
    const login = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'kid', password: 'member-password' }),
    })
    expect(login.status).toBe(200)
    const kidCookie = cookieOf(login)
    const kid = await prisma.user.findUnique({ where: { username: 'kid' } })

    const reset = await app.request(`/api/users/${kid!.id}/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ password: 'brand-new-pw-1' }),
    })
    expect(reset.status).toBe(200)
    expect((await app.request('/api/auth/me', { headers: { Cookie: kidCookie } })).status).toBe(401)

    const relogin = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'kid', password: 'brand-new-pw-1' }),
    })
    expect(relogin.status).toBe(200)
  })

  it('lifecycle: deactivate → restore → permanent delete', async () => {
    const kid = await prisma.user.findUnique({ where: { username: 'kid' } })

    // deactivate revokes sessions and keeps data
    const kidLogin = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'kid', password: 'brand-new-pw-1' }),
    })
    const kidCookie = cookieOf(kidLogin)
    const bank = await prisma.bank.create({
      data: { name: 'KidBank', emailSenderPattern: 'x@x', emailSubjectPattern: 'b', userId: kid!.id },
    })
    const bill = await prisma.bill.create({
      data: { bankId: bank.id, billingPeriod: '2026-07', amount: 42, dueDate: todayYMD() },
    })
    await prisma.notificationLog.create({
      data: { billId: bill.id, channel: 'telegram', message: 'x', success: true },
    })

    const deact = await app.request(`/api/users/${kid!.id}`, { method: 'DELETE', headers: { Cookie: adminCookie } })
    expect(deact.status).toBe(200)
    expect((await app.request('/api/auth/me', { headers: { Cookie: kidCookie } })).status).toBe(401)
    expect(await prisma.bank.count({ where: { userId: kid!.id } })).toBe(1)

    const list = await (await app.request('/api/users', { headers: { Cookie: adminCookie } })).json()
    const kidDto = list.find((u: any) => u.username === 'kid')
    expect(kidDto.deletedAt).not.toBeNull()

    // permanent delete requires deactivated state — restore first, then expect 400
    const restore = await app.request(`/api/users/${kid!.id}/restore`, { method: 'POST', headers: { Cookie: adminCookie } })
    expect(restore.status).toBe(200)
    const permActive = await app.request(`/api/users/${kid!.id}/permanent`, { method: 'DELETE', headers: { Cookie: adminCookie } })
    expect(permActive.status).toBe(400)

    // deactivate again, then permanent delete wipes everything
    await app.request(`/api/users/${kid!.id}`, { method: 'DELETE', headers: { Cookie: adminCookie } })
    const perm = await app.request(`/api/users/${kid!.id}/permanent`, { method: 'DELETE', headers: { Cookie: adminCookie } })
    expect(perm.status).toBe(200)
    expect(await prisma.user.count({ where: { id: kid!.id } })).toBe(0)
    expect(await prisma.bank.count({ where: { userId: kid!.id } })).toBe(0)
    expect(await prisma.bill.count({ where: { id: bill.id } })).toBe(0)
    expect(await prisma.notificationLog.count({ where: { billId: bill.id } })).toBe(0)

    // admin can be neither deactivated nor permanently deleted
    const bossRow = await prisma.user.findUnique({ where: { username: 'boss' } })
    expect((await app.request(`/api/users/${bossRow!.id}`, { method: 'DELETE', headers: { Cookie: adminCookie } })).status).toBe(400)
    expect((await app.request(`/api/users/${bossRow!.id}/permanent`, { method: 'DELETE', headers: { Cookie: adminCookie } })).status).toBe(400)
  })

  it('concurrent duplicate creates: one 201, one 409 (never 500)', async () => {
    const [a, b] = await Promise.all([
      createUser('race-user', 'race-password-1'),
      createUser('race-user', 'race-password-1'),
    ])
    expect([a.status, b.status].sort()).toEqual([201, 409])
  })
})
