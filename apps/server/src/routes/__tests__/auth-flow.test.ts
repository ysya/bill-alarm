import { describe, it, expect, beforeEach } from 'vitest'
import { createHash } from 'node:crypto'
import { setupTestDb } from '../../services/__tests__/helpers/test-db.js'

setupTestDb()

// Keep test output pristine: index.ts's pino logger reads LOG_LEVEL at import
// time and logs every app.request() call otherwise.
process.env.LOG_LEVEL = 'silent'

const { default: app } = await import('@/index.js')
const { _resetAuthRateLimit, SESSION_COOKIE } = await import('../auth.js')
const { default: prisma } = await import('@/prisma.js')

const CREDS = { username: 'frank', password: 'super-secret-pw' }

function cookieOf(res: Response): string {
  return res.headers.get('set-cookie')?.split(';')[0] ?? ''
}

function tokenOf(cookie: string): string {
  return cookie.slice(`${SESSION_COOKIE}=`.length)
}

describe('auth flow', () => {
  beforeEach(() => _resetAuthRateLimit())

  it('whitelists /api/health and /api/auth/status', async () => {
    expect((await app.request('/api/health')).status).toBe(200)
    const status = await app.request('/api/auth/status')
    expect(status.status).toBe(200)
    expect(await status.json()).toEqual({ initialized: false })
  })

  it('blocks protected APIs without a session', async () => {
    expect((await app.request('/api/banks')).status).toBe(401)
  })

  it('setup → cookie → protected API accessible → second setup forbidden', async () => {
    const res = await app.request('/api/auth/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(CREDS),
    })
    expect(res.status).toBe(200)
    const cookie = cookieOf(res)
    expect(cookie).toMatch(/^ba_session=/)

    const banks = await app.request('/api/banks', { headers: { Cookie: cookie } })
    expect(banks.status).toBe(200)

    const again = await app.request('/api/auth/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(CREDS),
    })
    expect(again.status).toBe(403)
  })

  it('login rejects wrong credentials and locks after 5 failures', async () => {
    for (let i = 0; i < 5; i++) {
      const res = await app.request('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'frank', password: 'nope-nope-nope' }),
      })
      expect(res.status).toBe(401)
    }
    const locked = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(CREDS),
    })
    expect(locked.status).toBe(429)
  })

  it('login → me → logout invalidates the session', async () => {
    const login = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(CREDS),
    })
    expect(login.status).toBe(200)
    const cookie = cookieOf(login)

    const me = await app.request('/api/auth/me', { headers: { Cookie: cookie } })
    expect(me.status).toBe(200)
    expect(await me.json()).toEqual({ username: 'frank' })

    await app.request('/api/auth/logout', { method: 'POST', headers: { Cookie: cookie } })
    expect((await app.request('/api/auth/me', { headers: { Cookie: cookie } })).status).toBe(401)
  })

  it('rolling extension re-issues the session cookie with a fresh expiry', async () => {
    const login = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(CREDS),
    })
    expect(login.status).toBe(200)
    const cookie = cookieOf(login)
    const tokenHash = createHash('sha256').update(tokenOf(cookie)).digest('hex')

    // Backdate lastExtendedAt so the next request falls outside EXTEND_AFTER_MS.
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000)
    await prisma.session.updateMany({ where: { tokenHash }, data: { lastExtendedAt: old } })

    const banks = await app.request('/api/banks', { headers: { Cookie: cookie } })
    expect(banks.status).toBe(200)

    const setCookie = banks.headers.get('set-cookie') ?? ''
    expect(setCookie).toContain(`${SESSION_COOKIE}=`)
    const expiresMatch = /Expires=([^;]+)/i.exec(setCookie)
    expect(expiresMatch).not.toBeNull()
    expect(new Date(expiresMatch![1]).getTime()).toBeGreaterThan(Date.now())
  })
})
