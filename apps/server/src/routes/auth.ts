import { Hono } from 'hono'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import type { Context } from 'hono'
import { getSetting, setSetting, KEYS } from '@/services/settings.js'
import { hashPassword, verifyPassword, createSession, validateSession, destroySession } from '@/services/auth.js'

export const SESSION_COOKIE = 'ba_session'

const credsSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(8, '密碼至少 8 碼'),
})

// Single-user app: one global lockout counter is enough (and can't be
// sidestepped by rotating IPs behind the CF proxy).
const MAX_FAILURES = 5
const LOCK_MS = 15 * 60 * 1000
let failCount = 0
let lockedUntil = 0

/** test-only */
export function _resetAuthRateLimit(): void {
  failCount = 0
  lockedUntil = 0
}

function setSessionCookie(c: Context, token: string, expiresAt: Date): void {
  setCookie(c, SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'Lax',
    secure: process.env.NODE_ENV === 'production',
    expires: expiresAt,
  })
}

const app = new Hono()

app.get('/status', async (c) => {
  const initialized = !!(await getSetting(KEYS.AUTH_PASSWORD_HASH))
  return c.json({ initialized })
})

app.post('/setup', zValidator('json', credsSchema), async (c) => {
  if (await getSetting(KEYS.AUTH_PASSWORD_HASH)) {
    return c.json({ error: '已完成初始化' }, 403)
  }
  const { username, password } = c.req.valid('json')
  await setSetting(KEYS.AUTH_USERNAME, username)
  await setSetting(KEYS.AUTH_PASSWORD_HASH, hashPassword(password))
  const { token, expiresAt } = await createSession()
  setSessionCookie(c, token, expiresAt)
  return c.json({ ok: true })
})

app.post('/login', zValidator('json', credsSchema.extend({ password: z.string().min(1) })), async (c) => {
  if (Date.now() < lockedUntil) {
    return c.json({ error: '嘗試次數過多，請 15 分鐘後再試' }, 429)
  }
  const { username, password } = c.req.valid('json')
  const expectedUser = await getSetting(KEYS.AUTH_USERNAME)
  const storedHash = await getSetting(KEYS.AUTH_PASSWORD_HASH)
  const ok = !!storedHash && username === expectedUser && verifyPassword(password, storedHash)
  if (!ok) {
    failCount += 1
    if (failCount >= MAX_FAILURES) {
      lockedUntil = Date.now() + LOCK_MS
      failCount = 0
    }
    return c.json({ error: '帳號或密碼錯誤' }, 401)
  }
  failCount = 0
  const { token, expiresAt } = await createSession()
  setSessionCookie(c, token, expiresAt)
  return c.json({ ok: true })
})

app.post('/logout', async (c) => {
  const token = getCookie(c, SESSION_COOKIE)
  if (token) await destroySession(token)
  deleteCookie(c, SESSION_COOKIE, { path: '/' })
  return c.json({ ok: true })
})

app.get('/me', async (c) => {
  // reached only when authGuard passed
  const username = await getSetting(KEYS.AUTH_USERNAME)
  return c.json({ username })
})

/** Guard for /api/* — allow whitelisted paths, otherwise require a valid session. */
export async function authGuard(c: Context, next: () => Promise<void>): Promise<Response | void> {
  const path = c.req.path
  const isPublic
    = path === '/api/health'
      || path === '/api/auth/login'
      || path === '/api/auth/setup'
      || path === '/api/auth/status'
      || path.startsWith('/api/calendar/feed/')
  if (isPublic) return next()

  const token = getCookie(c, SESSION_COOKIE)
  if (token && await validateSession(token)) return next()
  return c.json({ error: 'unauthorized' }, 401)
}

export default app
