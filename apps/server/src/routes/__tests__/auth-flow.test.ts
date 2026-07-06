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
    expect(await me.json()).toEqual({ username: 'frank', role: 'admin', telegramBound: false })

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

  it('rejects oversized auth request bodies with 413', async () => {
    // Real HTTP clients always send Content-Length; set it explicitly because
    // app.request() string bodies don't, which would fall into the stream path
    // where zValidator masks the limit error as a 400 instead.
    const body = JSON.stringify({ username: 'frank', password: 'x'.repeat(20 * 1024) })
    const res = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': String(body.length) },
      body,
    })
    expect(res.status).toBe(413)
  })

  it('rejects over-length credentials with 400 without counting toward lockout', async () => {
    const res = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'frank', password: 'x'.repeat(300) }),
    })
    expect(res.status).toBe(400)

    // Validation failures must not consume lockout budget: correct login still works.
    const login = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(CREDS),
    })
    expect(login.status).toBe(200)
  })

  it('lockout is per-username: locking frank does not lock other usernames', async () => {
    for (let i = 0; i < 5; i++) {
      await app.request('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'frank', password: 'nope-nope-nope' }),
      })
    }
    const frankLocked = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(CREDS),
    })
    expect(frankLocked.status).toBe(429)

    // an unrelated (even nonexistent) username is not locked out
    const other = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'someone-else', password: 'whatever-123' }),
    })
    expect(other.status).toBe(401)
  })

  it('change password: wrong current is 400, success revokes other sessions but keeps current', async () => {
    const login1 = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(CREDS),
    })
    const cookie1 = cookieOf(login1)
    const login2 = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(CREDS),
    })
    const cookie2 = cookieOf(login2)

    const wrong = await app.request('/api/auth/password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie1 },
      body: JSON.stringify({ currentPassword: 'not-the-password', newPassword: 'new-secret-pw-1' }),
    })
    expect(wrong.status).toBe(400)

    const ok = await app.request('/api/auth/password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie1 },
      body: JSON.stringify({ currentPassword: CREDS.password, newPassword: 'new-secret-pw-1' }),
    })
    expect(ok.status).toBe(200)

    // current session survives, the other one is revoked
    expect((await app.request('/api/auth/me', { headers: { Cookie: cookie1 } })).status).toBe(200)
    expect((await app.request('/api/auth/me', { headers: { Cookie: cookie2 } })).status).toBe(401)

    // new password works, old one does not
    const oldPw = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(CREDS),
    })
    expect(oldPw.status).toBe(401)
    const newPw = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'frank', password: 'new-secret-pw-1' }),
    })
    expect(newPw.status).toBe(200)
    // restore for later tests (file runs sequentially): change back
    const restore = await app.request('/api/auth/password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookieOf(newPw) },
      body: JSON.stringify({ currentPassword: 'new-secret-pw-1', newPassword: CREDS.password }),
    })
    expect(restore.status).toBe(200)
  })

  it('username spray cannot flush an active lockout', async () => {
    // Lock frank
    for (let i = 0; i < 5; i++) {
      await app.request('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'frank', password: 'nope-nope-nope' }),
      })
    }
    // Spray more than MAX_TRACKED distinct usernames to force eviction pressure
    for (let i = 0; i <= 1000; i++) {
      await app.request('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: `spray-${i}`, password: 'whatever-xx' }),
      })
    }
    // frank must still be locked
    const res = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(CREDS),
    })
    expect(res.status).toBe(429)
  })

  it('deactivated user cannot log in and it does not consume lockout budget', async () => {
    const { hashPassword } = await import('@/services/auth.js')
    await prisma.user.create({
      data: { username: 'ghost', passwordHash: hashPassword('ghost-password-1'), role: 'member', deletedAt: new Date() },
    })
    for (let i = 0; i < 6; i++) {
      const res = await app.request('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'ghost', password: 'ghost-password-1' }),
      })
      expect(res.status).toBe(401)
      expect((await res.json()).error).toBe('此帳號已停用')
    }
  })
})
