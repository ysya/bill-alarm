import { describe, it, expect } from 'vitest'
import { setupTestDb } from '../../services/__tests__/helpers/test-db.js'

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

  it('cannot delete the admin; deleting a member cascades sessions', async () => {
    const boss = await prisma.user.findUnique({ where: { username: 'boss' } })
    const delAdmin = await app.request(`/api/users/${boss!.id}`, {
      method: 'DELETE', headers: { Cookie: adminCookie },
    })
    expect(delAdmin.status).toBe(400)

    const kid = await prisma.user.findUnique({ where: { username: 'kid' } })
    const delKid = await app.request(`/api/users/${kid!.id}`, {
      method: 'DELETE', headers: { Cookie: adminCookie },
    })
    expect(delKid.status).toBe(200)
    expect(await prisma.session.count({ where: { userId: kid!.id } })).toBe(0)
    expect(await prisma.user.count()).toBe(1)

    expect((await app.request('/api/users/nonexistent-id', {
      method: 'DELETE', headers: { Cookie: adminCookie },
    })).status).toBe(404)
  })

  it('concurrent duplicate creates: one 201, one 409 (never 500)', async () => {
    const [a, b] = await Promise.all([
      createUser('race-user', 'race-password-1'),
      createUser('race-user', 'race-password-1'),
    ])
    expect([a.status, b.status].sort()).toEqual([201, 409])
  })
})
