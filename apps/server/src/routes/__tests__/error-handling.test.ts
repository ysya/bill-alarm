import { describe, it, expect, vi } from 'vitest'
import { setupTestDb } from '../../services/__tests__/helpers/test-db.js'

setupTestDb()
process.env.LOG_LEVEL = 'silent'

const { default: app } = await import('@/index.js')
const { default: prisma } = await import('@/prisma.js')
const { hashPassword } = await import('@/services/auth.js')

// Test-only route appended to the imported app instance so we can exercise
// app.onError without adding a throwing route to production code. Hono's
// router matcher locks itself on the first dispatched request, so this MUST
// be registered before any app.request()/app.fetch() call below.
app.get('/api/__test-throw', () => {
  throw new Error('secret detail')
})

function cookieOf(res: Response): string {
  return res.headers.get('set-cookie')?.split(';')[0] ?? ''
}

const setup = await app.request('/api/auth/setup', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'boss', password: 'admin-password' }),
})
const adminCookie = cookieOf(setup)

describe('global error handler', () => {
  it('an unhandled route error returns a generic 500 without leaking internal details', async () => {
    const res = await app.request('/api/__test-throw', { headers: { Cookie: adminCookie } })
    expect(res.status).toBe(500)
    const text = await res.text()
    expect(text).not.toContain('secret detail')
    expect(JSON.parse(text)).toEqual({ error: '伺服器內部錯誤' })
  })
})

describe('health endpoint', () => {
  it('is public and reports status + a version string', async () => {
    const res = await app.request('/api/health')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('ok')
    expect(typeof body.version).toBe('string')
    expect(body.version.length).toBeGreaterThan(0)
  })
})

describe('setup race guard', () => {
  it('setup after an admin already exists returns 403 (existing pre-check semantics)', async () => {
    // The module-level `setup` call above already created the one-and-only admin.
    const res = await app.request('/api/auth/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'someone-else', password: 'another-password' }),
    })
    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe('已完成初始化')
  })

  it('a concurrent setup that slips past the pre-check hits the unique-username race and returns 403, not 500', async () => {
    // Simulate a concurrent request that already committed a user row with this
    // exact username (User.username is @unique) before our request's create() runs.
    await prisma.user.create({
      data: { username: 'race-admin', passwordHash: await hashPassword('whatever-pw-1'), role: 'admin' },
    })

    // Force this request's own pre-check to observe 0 users, as if it read
    // before the concurrent create committed, so it proceeds to prisma.user.create().
    const countSpy = vi.spyOn(prisma.user, 'count').mockResolvedValueOnce(0)
    try {
      const res = await app.request('/api/auth/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'race-admin', password: 'another-password' }),
      })
      expect(res.status).toBe(403)
      expect((await res.json()).error).toBe('已完成初始化')
    } finally {
      countSpy.mockRestore()
    }
  })
})
