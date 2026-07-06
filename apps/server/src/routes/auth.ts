import { Hono } from 'hono'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'
import { bodyLimit } from 'hono/body-limit'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import type { Context } from 'hono'
import prisma from '@/prisma.js'
import {
  hashPassword, verifyPassword, createSession, validateSession,
  destroySession, destroyUserSessions, type AuthUser,
} from '@/services/auth.js'
import { getBotUsername } from '@/services/telegram.js'
import { createBindCode, confirmBind } from '@/services/telegram-binding.js'

export const SESSION_COOKIE = 'ba_session'

export const passwordSchema = z.string().min(8, '密碼至少 8 碼').max(256)

export const credsSchema = z.object({
  username: z.string().min(1).max(64),
  password: passwordSchema,
})

declare module 'hono' {
  interface ContextVariableMap {
    authUser: AuthUser
  }
}

/** Only meaningful after authGuard has run (all non-whitelisted /api routes). */
export function getAuthUser(c: Context): AuthUser {
  return c.get('authUser')
}

// Per-username lockout: a family member's typos must not lock everyone out.
// Unknown usernames are counted too, so probing names is equally throttled.
const MAX_FAILURES = 5
const LOCK_MS = 15 * 60 * 1000
const MAX_TRACKED = 1000 // bound memory against random-username spraying
const failures = new Map<string, { count: number; lockedUntil: number }>()

function isLocked(username: string): boolean {
  const entry = failures.get(username)
  return !!entry && Date.now() < entry.lockedUntil
}

function recordFailure(username: string): void {
  if (failures.size >= MAX_TRACKED) {
    // Evict only entries that are not actively locked — a username spray must
    // never flush someone's live lockout. If every entry is a live lock the
    // map can temporarily exceed the cap; those entries expire within LOCK_MS.
    const now = Date.now()
    for (const [key, value] of failures) {
      if (now >= value.lockedUntil) failures.delete(key)
    }
  }
  const entry = failures.get(username) ?? { count: 0, lockedUntil: 0 }
  entry.count += 1
  if (entry.count >= MAX_FAILURES) {
    entry.lockedUntil = Date.now() + LOCK_MS
    entry.count = 0
  }
  failures.set(username, entry)
}

/** test-only */
export function _resetAuthRateLimit(): void {
  failures.clear()
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

// Global-infrastructure surface: only the admin may touch these. Every other
// authenticated route is available to all users and self-scopes its data.
const ADMIN_ONLY: Array<{ method: string; pattern: RegExp }> = [
  { method: '*', pattern: /^\/api\/users(\/|$)/ },
  { method: 'POST', pattern: /^\/api\/config\/(llm|gemini|openai|telegram|scan)$/ },
  { method: 'GET', pattern: /^\/api\/config\/status$/ },
  { method: 'POST', pattern: /^\/api\/llm\/test$/ },
]

const app = new Hono()

// Unauthenticated surface: cap request bodies so oversized payloads can't
// reach JSON parsing or scrypt.
app.use(bodyLimit({
  maxSize: 16 * 1024,
  onError: (c) => c.json({ error: '請求內容過大' }, 413),
}))

app.get('/status', async (c) => {
  const initialized = (await prisma.user.count()) > 0
  return c.json({ initialized })
})

app.post('/setup', zValidator('json', credsSchema), async (c) => {
  if ((await prisma.user.count()) > 0) {
    return c.json({ error: '已完成初始化' }, 403)
  }
  const { username, password } = c.req.valid('json')
  const user = await prisma.user.create({
    data: { username, passwordHash: hashPassword(password), role: 'admin' },
  })
  const { token, expiresAt } = await createSession(user.id)
  setSessionCookie(c, token, expiresAt)
  return c.json({ ok: true })
})

app.post('/login', zValidator('json', credsSchema.extend({ password: z.string().min(1).max(256) })), async (c) => {
  const { username, password } = c.req.valid('json')
  if (isLocked(username)) {
    return c.json({ error: '嘗試次數過多，請 15 分鐘後再試' }, 429)
  }
  const user = await prisma.user.findUnique({ where: { username } })
  const ok = !!user && verifyPassword(password, user.passwordHash)
  if (!ok) {
    recordFailure(username)
    return c.json({ error: '帳號或密碼錯誤' }, 401)
  }
  if (user.deletedAt) {
    // Correct password on a deactivated account: reject without touching lockout state.
    return c.json({ error: '此帳號已停用' }, 401)
  }
  failures.delete(username)
  const { token, expiresAt } = await createSession(user.id)
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
  const authUser = getAuthUser(c)
  const user = await prisma.user.findUnique({ where: { id: authUser.id } })
  if (!user) return c.json({ error: 'unauthorized' }, 401)
  return c.json({ username: user.username, role: user.role, telegramBound: !!user.telegramChatId })
})

app.post('/password', zValidator('json', z.object({
  currentPassword: z.string().min(1).max(256),
  newPassword: passwordSchema,
})), async (c) => {
  const authUser = getAuthUser(c)
  const { currentPassword, newPassword } = c.req.valid('json')
  const user = await prisma.user.findUnique({ where: { id: authUser.id } })
  if (!user) return c.json({ error: 'unauthorized' }, 401)
  if (!verifyPassword(currentPassword, user.passwordHash)) {
    // 400 (not 401): the SPA's 401 interceptor would bounce the user to /login.
    return c.json({ error: '目前密碼錯誤' }, 400)
  }
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: hashPassword(newPassword) } })
  const token = getCookie(c, SESSION_COOKIE)
  await destroyUserSessions(user.id, token)
  return c.json({ ok: true })
})

app.post('/telegram/bind', async (c) => {
  const authUser = getAuthUser(c)
  const botUsername = await getBotUsername()
  if (!botUsername) return c.json({ error: '尚未設定 Telegram Bot Token' }, 400)
  const { code, expiresAt } = createBindCode(authUser.id)
  return c.json({ deepLink: `https://t.me/${botUsername}?start=${code}`, expiresAt })
})

app.post('/telegram/confirm', async (c) => {
  const authUser = getAuthUser(c)
  const result = await confirmBind(authUser.id)
  if (result.status === 'ok') return c.json({ ok: true })
  if (result.status === 'not_seen') {
    return c.json({ error: '還沒收到 Start，請先在 Telegram 按 Start 再試' }, 404)
  }
  return c.json({ error: '綁定連結已過期，請重新產生' }, 410)
})

app.delete('/telegram', async (c) => {
  const authUser = getAuthUser(c)
  await prisma.user.update({ where: { id: authUser.id }, data: { telegramChatId: null } })
  return c.json({ ok: true })
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
  if (token) {
    const session = await validateSession(token)
    if (session.valid && session.user) {
      c.set('authUser', session.user)
      if (session.user.role !== 'admin') {
        const method = c.req.method === 'HEAD' ? 'GET' : c.req.method
        const denied = ADMIN_ONLY.some(r => (r.method === '*' || r.method === method) && r.pattern.test(path))
        if (denied) return c.json({ error: 'forbidden' }, 403)
      }
      if (session.extended && session.expiresAt) {
        setSessionCookie(c, token, session.expiresAt)
      }
      return next()
    }
  }
  return c.json({ error: 'unauthorized' }, 401)
}

export default app
