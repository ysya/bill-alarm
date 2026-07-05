# Multi-User Management (Family Sharing) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add multi-user support to bill-alarm: shared household data, admin/member roles, admin-provisioned accounts, and per-user Telegram binding with notification fan-out.

**Architecture:** New `User` table absorbs the legacy single-user credentials from `settings` (SQL data migration; sessions wiped, one re-login). `authGuard` attaches the session's user to Hono context and enforces a central deny-by-default allow-list for members. Telegram becomes per-user: a deep-link + one-time-code binding flow stores each user's chat id, and all notifications broadcast to every bound user (deduped by chat id).

**Tech Stack:** Hono, Prisma + SQLite, Zod, Vitest; Nuxt 4 SPA, shadcn-vue, vue-sonner.

**Spec:** `docs/superpowers/specs/2026-07-05-user-management-design.md`

## Global Constraints

- Work on branch `feature/user-management` (create from `main` before Task 1).
- Roles are exactly the strings `'admin'` and `'member'`. Admin is unique (first account, from migration or `/setup`); every account created via the users API is `'member'`; the admin account cannot be deleted; no role changes.
- Member authorization is a central allow-list inside `authGuard` (deny by default with 403). Do NOT scatter per-route role checks.
- Password rule everywhere a password is set: `z.string().min(8, '密碼至少 8 碼').max(256)`. Username rule: `z.string().min(1).max(64)`.
- Login lockout: per submitted username, 5 failures → 15 min lock, in-memory, `_resetAuthRateLimit()` test helper preserved.
- Session semantics unchanged: `ba_session` cookie, 30-day rolling TTL, 24h extension threshold, SHA-256 token hash.
- Telegram binding code: 16 hex chars, 10-minute TTL, in-memory store.
- Broadcast dedupes chat ids; `NotificationLog` schema unchanged (one row per notification; `success` = at least one recipient delivered).
- Settings keys migrated then deleted: `auth_username`, `auth_password_hash`, `telegram_chat_id`. `ENV_MAP` entry for `TELEGRAM_CHAT_ID` is removed. `telegram_bot_token` stays a global setting.
- User-facing copy in Traditional Chinese; code/comments/commits in English (conventional commits).
- After each server task: `pnpm --filter @bill-alarm/server test` passes. Web tasks: `pnpm --filter @bill-alarm/web generate` exits 0.
- Wrong-current-password on `POST /api/auth/password` returns **400** (not 401 — the web client's 401 interceptor redirects to /login).

---

### Task 1: User model, migration, and auth cutover to the users table

**Files:**
- Modify: `apps/server/prisma/schema.prisma`
- Create: `apps/server/prisma/migrations/<timestamp>_add_users/migration.sql` (via `--create-only`, then replace content)
- Modify: `apps/server/src/services/auth.ts`
- Modify: `apps/server/src/routes/auth.ts`
- Test: `apps/server/src/services/__tests__/auth.test.ts`, `apps/server/src/routes/__tests__/auth-flow.test.ts`

**Interfaces:**
- Consumes: existing `Session` model, scrypt helpers, existing auth-flow behavior.
- Produces (later tasks rely on these exact names):
  - Prisma `User` model: `id, username (unique), passwordHash, role (default "member"), telegramChatId (nullable), createdAt, updatedAt`
  - `interface AuthUser { id: string; username: string; role: string }` (from `services/auth.ts`)
  - `createSession(userId: string): Promise<{ token: string; expiresAt: Date }>`
  - `SessionValidation` gains `user: AuthUser | null` (set when `valid`)
  - `destroyUserSessions(userId: string, exceptToken?: string): Promise<void>`
  - From `routes/auth.ts`: `passwordSchema`, `credsSchema`, `getAuthUser(c: Context): AuthUser`, Hono `ContextVariableMap` augmented with `authUser: AuthUser`
  - `GET /api/auth/me` → `{ username, role, telegramBound }`
  - `POST /api/auth/password` `{ currentPassword, newPassword }` → 200 `{ ok: true }` / 400 `{ error: '目前密碼錯誤' }`
  - `/setup` creates the admin `User`; `/status` checks `prisma.user.count()`

- [ ] **Step 1: Update Prisma schema**

In `apps/server/prisma/schema.prisma`, add the `User` model right above `Session`, and add the two user fields to `Session`:

```prisma
model User {
  id             String    @id @default(uuid(7))
  username       String    @unique
  passwordHash   String
  role           String    @default("member") // 'admin' | 'member'
  telegramChatId String?
  createdAt      DateTime  @default(now())
  updatedAt      DateTime  @updatedAt
  sessions       Session[]

  @@map("users")
}

model Session {
  id             String   @id @default(uuid(7))
  tokenHash      String   @unique
  userId         String
  user           User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  createdAt      DateTime @default(now())
  expiresAt      DateTime
  lastExtendedAt DateTime @default(now())

  @@map("sessions")
}
```

- [ ] **Step 2: Create the migration with hand-written data migration**

```bash
cd apps/server
pnpm exec prisma migrate dev --name add_users --create-only
```

Replace the ENTIRE content of the generated `prisma/migrations/<timestamp>_add_users/migration.sql` with:

```sql
-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "telegramChatId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- Data migration: promote the legacy single-user credentials (settings table)
-- to the admin user. The legacy telegram chat id becomes the admin's binding.
INSERT INTO "users" ("id", "username", "passwordHash", "role", "telegramChatId", "createdAt", "updatedAt")
SELECT
    lower(hex(randomblob(16))),
    (SELECT "value" FROM "settings" WHERE "key" = 'auth_username'),
    (SELECT "value" FROM "settings" WHERE "key" = 'auth_password_hash'),
    'admin',
    (SELECT "value" FROM "settings" WHERE "key" = 'telegram_chat_id'),
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
WHERE EXISTS (SELECT 1 FROM "settings" WHERE "key" = 'auth_username')
  AND EXISTS (SELECT 1 FROM "settings" WHERE "key" = 'auth_password_hash');

DELETE FROM "settings" WHERE "key" IN ('auth_username', 'auth_password_hash', 'telegram_chat_id');

-- Sessions are wiped (everyone re-logs-in once) and rebuilt with a required userId FK.
DROP TABLE "sessions";
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL,
    "lastExtendedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "sessions_tokenHash_key" ON "sessions"("tokenHash");
```

- [ ] **Step 3: Verify the data migration against a seeded dev DB, then apply**

The dev DB currently has no auth keys (reset to setup state earlier). Seed fake legacy rows, apply, verify, then clean up:

```bash
cd apps/server
sqlite3 data/bill-alarm.db "INSERT OR REPLACE INTO settings (key, value, updatedAt) VALUES ('auth_username','mig-test',CURRENT_TIMESTAMP), ('auth_password_hash','aa:bb',CURRENT_TIMESTAMP), ('telegram_chat_id','999',CURRENT_TIMESTAMP);"
pnpm exec prisma migrate dev
sqlite3 data/bill-alarm.db "SELECT username, role, telegramChatId FROM users; SELECT count(*) FROM settings WHERE key IN ('auth_username','auth_password_hash','telegram_chat_id');"
```

Expected: one row `mig-test|admin|999`, and count `0`.

Clean up the fake admin so dev returns to setup state, and regenerate the client (Prisma 7 no longer auto-generates):

```bash
sqlite3 data/bill-alarm.db "DELETE FROM users; DELETE FROM sessions;"
pnpm exec prisma generate
```

- [ ] **Step 4: Write the failing service tests**

In `apps/server/src/services/__tests__/auth.test.ts`, change the vitest import to `import { describe, it, expect, beforeAll } from 'vitest'` and replace the entire `describe('sessions', ...)` block (the `password hashing` block is untouched) with:

```ts
const { createSession, validateSession, destroySession, destroyUserSessions } = await import('../auth.js')
const { default: prisma } = await import('@/prisma.js')

describe('sessions', () => {
  let userId: string

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { username: 'session-user', passwordHash: 'x:y', role: 'admin' },
    })
    userId = user.id
  })

  it('creates a session validatable by its token, carrying the user', async () => {
    const { token } = await createSession(userId)
    const result = await validateSession(token)
    expect(result.valid).toBe(true)
    expect(result.user).toEqual({ id: userId, username: 'session-user', role: 'admin' })
  })

  it('stores only the token hash, not the token', async () => {
    const { token } = await createSession(userId)
    const rows = await prisma.session.findMany()
    expect(rows.some(r => r.tokenHash === token)).toBe(false)
  })

  it('rejects unknown and destroyed tokens', async () => {
    expect((await validateSession('deadbeef')).valid).toBe(false)
    const { token } = await createSession(userId)
    await destroySession(token)
    expect((await validateSession(token)).valid).toBe(false)
  })

  it('rejects expired sessions', async () => {
    const { token } = await createSession(userId)
    await prisma.session.updateMany({ where: { tokenHash: hashToken(token) }, data: { expiresAt: new Date(Date.now() - 1000) } })
    expect((await validateSession(token)).valid).toBe(false)
  })

  it('extends expiry when last extension is older than 24h', async () => {
    const { token } = await createSession(userId)
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000)
    await prisma.session.updateMany({ where: { tokenHash: hashToken(token) }, data: { lastExtendedAt: old } })
    const result = await validateSession(token)
    expect(result.valid).toBe(true)
    expect(result.extended).toBe(true)
    const row = await prisma.session.findUnique({ where: { tokenHash: hashToken(token) } })
    expect(row).not.toBeNull()
    expect(row!.lastExtendedAt.getTime()).toBeGreaterThan(old.getTime())
  })

  it('destroyUserSessions revokes all sessions except the given token', async () => {
    const a = await createSession(userId)
    const b = await createSession(userId)
    await destroyUserSessions(userId, a.token)
    expect((await validateSession(a.token)).valid).toBe(true)
    expect((await validateSession(b.token)).valid).toBe(false)
    await destroyUserSessions(userId)
    expect((await validateSession(a.token)).valid).toBe(false)
  })
})
```

- [ ] **Step 5: Write the failing route tests**

In `apps/server/src/routes/__tests__/auth-flow.test.ts`:

(a) Change the `me` assertion in the login → me → logout test:

```ts
    expect(await me.json()).toEqual({ username: 'frank', role: 'admin', telegramBound: false })
```

(b) Append these tests inside `describe('auth flow', ...)`:

```ts
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
```

- [ ] **Step 6: Run both test files to verify failures**

Run: `pnpm --filter @bill-alarm/server test -- src/services/__tests__/auth.test.ts src/routes/__tests__/auth-flow.test.ts`
Expected: FAIL (createSession arity, missing `destroyUserSessions`, missing `/api/auth/password`, `me` shape).

- [ ] **Step 7: Implement the service changes**

Replace the session section of `apps/server/src/services/auth.ts` (everything below the scrypt helpers `hashPassword`/`verifyPassword`) with:

```ts
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 days, rolling
const EXTEND_AFTER_MS = 24 * 60 * 60 * 1000

export interface AuthUser {
  id: string
  username: string
  role: string
}

function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export async function createSession(userId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS)
  await prisma.session.create({ data: { tokenHash: tokenHash(token), expiresAt, userId } })
  // opportunistic cleanup of expired rows
  await prisma.session.deleteMany({ where: { expiresAt: { lt: new Date() } } })
  return { token, expiresAt }
}

export interface SessionValidation {
  valid: boolean
  extended: boolean
  expiresAt: Date | null
  user: AuthUser | null
}

export async function validateSession(token: string): Promise<SessionValidation> {
  const session = await prisma.session.findUnique({
    where: { tokenHash: tokenHash(token) },
    include: { user: true },
  })
  if (!session || session.expiresAt.getTime() < Date.now()) {
    return { valid: false, extended: false, expiresAt: null, user: null }
  }
  const user: AuthUser = { id: session.user.id, username: session.user.username, role: session.user.role }
  if (Date.now() - session.lastExtendedAt.getTime() > EXTEND_AFTER_MS) {
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS)
    await prisma.session.updateMany({
      where: { id: session.id },
      data: { expiresAt, lastExtendedAt: new Date() },
    })
    return { valid: true, extended: true, expiresAt, user }
  }
  return { valid: true, extended: false, expiresAt: session.expiresAt, user }
}

export async function destroySession(token: string): Promise<void> {
  await prisma.session.deleteMany({ where: { tokenHash: tokenHash(token) } })
}

/** Revoke every session of a user; optionally keep the caller's own session alive. */
export async function destroyUserSessions(userId: string, exceptToken?: string): Promise<void> {
  await prisma.session.deleteMany({
    where: {
      userId,
      ...(exceptToken ? { tokenHash: { not: tokenHash(exceptToken) } } : {}),
    },
  })
}
```

- [ ] **Step 8: Rewrite `apps/server/src/routes/auth.ts`**

Full new content (bodyLimit, cookie helper, and public whitelist survive; login/setup/status/me move to the users table; the `getSetting`/`setSetting`/`KEYS` imports are gone):

```ts
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
  if (failures.size > MAX_TRACKED) failures.clear()
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
      if (session.extended && session.expiresAt) {
        setSessionCookie(c, token, session.expiresAt)
      }
      return next()
    }
  }
  return c.json({ error: 'unauthorized' }, 401)
}

export default app
```

- [ ] **Step 9: Run the full server suite**

Run: `pnpm --filter @bill-alarm/server test`
Expected: ALL PASS.

- [ ] **Step 10: Commit**

```bash
git add apps/server/prisma apps/server/src/services/auth.ts apps/server/src/routes/auth.ts apps/server/src/services/__tests__/auth.test.ts apps/server/src/routes/__tests__/auth-flow.test.ts
git commit -m "feat(server): users table with admin migration, auth cutover, per-username lockout, change password"
```

---

### Task 2: Member role enforcement + unpay endpoint

**Files:**
- Modify: `apps/server/src/routes/auth.ts` (authGuard only)
- Modify: `apps/server/src/routes/bills.ts` (add `POST /:id/unpay`)
- Test: `apps/server/src/routes/__tests__/role-guard.test.ts` (new)

**Interfaces:**
- Consumes: `getAuthUser`, `authGuard` (Task 1).
- Produces: member allow-list semantics (exact list below); `POST /api/bills/:id/unpay` → bill JSON (status back to pending, paidAt cleared). Frontend tasks rely on members getting **403 JSON `{ error: 'forbidden' }`** on non-allow-listed routes.

- [ ] **Step 1: Write the failing tests**

Create `apps/server/src/routes/__tests__/role-guard.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { setupTestDb } from '../../services/__tests__/helpers/test-db.js'

setupTestDb()
process.env.LOG_LEVEL = 'silent'

const { default: app } = await import('@/index.js')
const { default: prisma } = await import('@/prisma.js')
const { hashPassword } = await import('@/services/auth.js')

function cookieOf(res: Response): string {
  return res.headers.get('set-cookie')?.split(';')[0] ?? ''
}

async function loginAs(username: string, password: string): Promise<string> {
  const res = await app.request('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  expect(res.status).toBe(200)
  return cookieOf(res)
}

// Bootstrap: admin via /setup, member directly in the DB.
const setup = await app.request('/api/auth/setup', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'boss', password: 'admin-password' }),
})
if (setup.status !== 200) throw new Error('setup failed')
await prisma.user.create({
  data: { username: 'kid', passwordHash: hashPassword('member-password'), role: 'member' },
})

describe('member allow-list', () => {
  it('member can read bills, banks, scan logs, statuses, calendar info, and self auth', async () => {
    const cookie = await loginAs('kid', 'member-password')
    for (const path of ['/api/bills', '/api/bills/summary', '/api/banks', '/api/scan-logs', '/api/integrations/status', '/api/calendar/info', '/api/auth/me']) {
      const res = await app.request(path, { headers: { Cookie: cookie } })
      expect(res.status, path).not.toBe(403)
      expect(res.status, path).not.toBe(401)
    }
  })

  it('member can mark paid and unpay', async () => {
    const cookie = await loginAs('kid', 'member-password')
    const bank = await prisma.bank.create({
      data: { name: 'T-Bank', emailSenderPattern: 'x@x', emailSubjectPattern: 'bill' },
    })
    const bill = await prisma.bill.create({
      data: { bankId: bank.id, billingPeriod: '2026-06', amount: 100, dueDate: new Date() },
    })
    const pay = await app.request(`/api/bills/${bill.id}/pay`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({}),
    })
    expect(pay.status).toBe(200)
    const unpay = await app.request(`/api/bills/${bill.id}/unpay`, {
      method: 'POST', headers: { Cookie: cookie },
    })
    expect(unpay.status).toBe(200)
    const after = await prisma.bill.findUnique({ where: { id: bill.id } })
    expect(after!.status).toBe('pending')
    expect(after!.paidAt).toBeNull()
  })

  it('member gets 403 on admin-only routes', async () => {
    const cookie = await loginAs('kid', 'member-password')
    const cases: Array<[string, string]> = [
      ['GET', '/api/users'],
      ['POST', '/api/banks'],
      ['PATCH', '/api/bills/some-id'],
      ['DELETE', '/api/bills/some-id'],
      ['POST', '/api/bills/some-id/reparse'],
      ['GET', '/api/config/status'],
      ['POST', '/api/config/telegram'],
      ['GET', '/api/notification-rules'],
      ['POST', '/api/email/save'],
      ['POST', '/api/calendar/rotate'],
      ['POST', '/api/telegram/test'],
    ]
    for (const [method, path] of cases) {
      const res = await app.request(path, {
        method,
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: method === 'GET' ? undefined : JSON.stringify({}),
      })
      expect(res.status, `${method} ${path}`).toBe(403)
    }
  })

  it('admin passes everywhere members are blocked', async () => {
    const cookie = await loginAs('boss', 'admin-password')
    const res = await app.request('/api/notification-rules', { headers: { Cookie: cookie } })
    expect(res.status).toBe(200)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @bill-alarm/server test -- src/routes/__tests__/role-guard.test.ts`
Expected: FAIL (no 403s yet; unpay 404).

- [ ] **Step 3: Implement the allow-list in authGuard and the unpay route**

In `apps/server/src/routes/auth.ts`, add above `authGuard`:

```ts
// Members are daily-operations only. Everything not matched here requires admin.
const MEMBER_ALLOW: Array<{ method: string; pattern: RegExp }> = [
  { method: 'GET', pattern: /^\/api\/bills(\/|$)/ }, // list / summary / :id / :id/pdf
  { method: 'PATCH', pattern: /^\/api\/bills\/[^/]+\/pay$/ },
  { method: 'POST', pattern: /^\/api\/bills\/[^/]+\/unpay$/ },
  { method: 'GET', pattern: /^\/api\/banks$/ },
  { method: 'POST', pattern: /^\/api\/email\/scan$/ },
  { method: 'GET', pattern: /^\/api\/scan-events$/ },
  { method: 'GET', pattern: /^\/api\/scan-logs$/ },
  { method: 'GET', pattern: /^\/api\/integrations\/status$/ },
  { method: 'GET', pattern: /^\/api\/email\/status$/ },
  { method: 'GET', pattern: /^\/api\/calendar\/info$/ },
  { method: 'GET', pattern: /^\/api\/auth\/me$/ },
  { method: 'POST', pattern: /^\/api\/auth\/logout$/ },
  { method: 'POST', pattern: /^\/api\/auth\/password$/ },
  { method: 'POST', pattern: /^\/api\/auth\/telegram\/bind$/ },
  { method: 'POST', pattern: /^\/api\/auth\/telegram\/confirm$/ },
  { method: 'DELETE', pattern: /^\/api\/auth\/telegram$/ },
]
```

In `authGuard`, replace the valid-session branch body with:

```ts
    if (session.valid && session.user) {
      c.set('authUser', session.user)
      if (session.user.role !== 'admin') {
        const method = c.req.method
        const allowed = MEMBER_ALLOW.some(r => r.method === method && r.pattern.test(path))
        if (!allowed) return c.json({ error: 'forbidden' }, 403)
      }
      if (session.extended && session.expiresAt) {
        setSessionCookie(c, token, session.expiresAt)
      }
      return next()
    }
```

In `apps/server/src/routes/bills.ts`, add directly under the `/:id/pay` route:

```ts
// Revert a paid bill back to pending (undo for "標記已繳"; member-allowed)
app.post('/:id/unpay', async (c) => {
  const existing = await prisma.bill.findUnique({ where: { id: c.req.param('id') } })
  if (!existing) return c.json({ error: 'Bill not found' }, 404)
  const bill = await prisma.bill.update({
    where: { id: existing.id },
    data: { status: BillStatus.PENDING, paidAt: null },
  })
  return c.json(bill)
})
```

- [ ] **Step 4: Run the full server suite**

Run: `pnpm --filter @bill-alarm/server test`
Expected: ALL PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/routes/auth.ts apps/server/src/routes/bills.ts apps/server/src/routes/__tests__/role-guard.test.ts
git commit -m "feat(server): central member allow-list in authGuard, bill unpay endpoint"
```

---

### Task 3: Users management API

**Files:**
- Create: `apps/server/src/routes/users.ts`
- Modify: `apps/server/src/index.ts` (mount)
- Test: `apps/server/src/routes/__tests__/users.test.ts` (new)

**Interfaces:**
- Consumes: `passwordSchema`, `credsSchema`, member-deny default (Task 2 — `/api/users/*` is not allow-listed, so members are rejected by authGuard); `destroyUserSessions`, `hashPassword` (Task 1).
- Produces (frontend Task 8 relies on):
  - `GET /api/users` → `Array<{ id, username, role, telegramBound, createdAt }>`
  - `POST /api/users` `{ username, password }` → 201 user DTO; 409 `{ error: '帳號名稱已存在' }`
  - `POST /api/users/:id/reset-password` `{ password }` → `{ ok: true }`, revokes all target sessions
  - `DELETE /api/users/:id` → `{ ok: true }`; 400 `{ error: '無法刪除管理員帳號' }` for the admin; 404 unknown id

- [ ] **Step 1: Write the failing tests**

Create `apps/server/src/routes/__tests__/users.test.ts`:

```ts
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
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @bill-alarm/server test -- src/routes/__tests__/users.test.ts`
Expected: FAIL with 404s (route not mounted).

- [ ] **Step 3: Implement `apps/server/src/routes/users.ts`**

```ts
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import prisma from '@/prisma.js'
import { hashPassword, destroyUserSessions } from '@/services/auth.js'
import { credsSchema, passwordSchema } from './auth.js'

// Admin-only by construction: /api/users/* is not in the member allow-list,
// so authGuard rejects members before these handlers run.
const app = new Hono()

function toDTO(u: { id: string; username: string; role: string; telegramChatId: string | null; createdAt: Date }) {
  return { id: u.id, username: u.username, role: u.role, telegramBound: !!u.telegramChatId, createdAt: u.createdAt }
}

app.get('/', async (c) => {
  const users = await prisma.user.findMany({ orderBy: { createdAt: 'asc' } })
  return c.json(users.map(toDTO))
})

app.post('/', zValidator('json', credsSchema), async (c) => {
  const { username, password } = c.req.valid('json')
  const existing = await prisma.user.findUnique({ where: { username } })
  if (existing) return c.json({ error: '帳號名稱已存在' }, 409)
  const user = await prisma.user.create({
    data: { username, passwordHash: hashPassword(password), role: 'member' },
  })
  return c.json(toDTO(user), 201)
})

app.post('/:id/reset-password', zValidator('json', z.object({ password: passwordSchema })), async (c) => {
  const user = await prisma.user.findUnique({ where: { id: c.req.param('id') } })
  if (!user) return c.json({ error: '找不到使用者' }, 404)
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: hashPassword(c.req.valid('json').password) },
  })
  await destroyUserSessions(user.id)
  return c.json({ ok: true })
})

app.delete('/:id', async (c) => {
  const user = await prisma.user.findUnique({ where: { id: c.req.param('id') } })
  if (!user) return c.json({ error: '找不到使用者' }, 404)
  if (user.role === 'admin') return c.json({ error: '無法刪除管理員帳號' }, 400)
  await prisma.user.delete({ where: { id: user.id } }) // sessions cascade
  return c.json({ ok: true })
})

export default app
```

In `apps/server/src/index.ts`, add the import and mount (after the auth route line):

```ts
import userRoutes from './routes/users.js'
```

```ts
app.route('/api/users', userRoutes)
```

- [ ] **Step 4: Run the full server suite**

Run: `pnpm --filter @bill-alarm/server test`
Expected: ALL PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/routes/users.ts apps/server/src/index.ts apps/server/src/routes/__tests__/users.test.ts
git commit -m "feat(server): admin users management API"
```

---

### Task 4: Telegram per-user send + broadcast fan-out

**Files:**
- Modify: `apps/server/src/services/telegram.ts`
- Modify: `apps/server/src/services/notification.ts` (3 call sites)
- Modify: `apps/server/src/services/settings.ts` (drop `TELEGRAM_CHAT_ID` from `ENV_MAP`; keep the `KEYS` entry — the migration SQL references the string, and stale env values must not resurrect the old behavior)
- Modify: `apps/server/src/routes/system.ts` (`/telegram/test`)
- Modify: `apps/server/src/routes/config.ts` (`POST /telegram` token-only; `/status` boundCount)
- Test: `apps/server/src/services/__tests__/telegram.test.ts` (new)

**Interfaces:**
- Consumes: `prisma.user` (Task 1), `getAuthUser` (Task 1).
- Produces (Task 5 and frontend rely on):
  - `sendMessage(chatId: string, text: string): Promise<boolean>`
  - `interface BroadcastResult { ok: boolean; sent: number; failed: number; errors: string[] }`
  - `broadcast(text: string): Promise<BroadcastResult>`
  - `sendNewBillAlert / sendBillReminder / sendOverdueWarning: (bill, bank) => Promise<BroadcastResult>`
  - `sendTestMessage(chatId: string): Promise<boolean>`
  - `isConfigured(): Promise<boolean>` (bot token only)
  - `getBotUsername(): Promise<string | null>` (getMe, cached per process)
  - `getUpdates(): Promise<TgUpdate[]>`; `interface TgUpdate { update_id: number; message?: { text?: string; chat: { id: number } } }`
  - `_resetTelegramCaches(): void` (test helper)
  - `GET /api/config/status` → `telegram: { isConfigured: boolean; boundCount: number }`
  - `POST /api/config/telegram` body `{ botToken }`

- [ ] **Step 1: Write the failing tests**

Create `apps/server/src/services/__tests__/telegram.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setupTestDb } from './helpers/test-db.js'

setupTestDb()

const { default: prisma } = await import('@/prisma.js')
const { setSetting, KEYS } = await import('../settings.js')
const telegram = await import('../telegram.js')

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

function okResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 })
}

beforeEach(async () => {
  fetchMock.mockReset()
  telegram._resetTelegramCaches()
  await prisma.user.deleteMany()
})

describe('broadcast', () => {
  it('sends to all bound users, deduplicating chat ids', async () => {
    await setSetting(KEYS.TELEGRAM_BOT_TOKEN, 'tok')
    await prisma.user.createMany({
      data: [
        { username: 'a', passwordHash: 'x:y', role: 'admin', telegramChatId: '111' },
        { username: 'b', passwordHash: 'x:y', role: 'member', telegramChatId: '222' },
        { username: 'c', passwordHash: 'x:y', role: 'member', telegramChatId: '111' }, // same group as a
        { username: 'd', passwordHash: 'x:y', role: 'member' }, // unbound
      ],
    })
    fetchMock.mockResolvedValue(okResponse({ ok: true }))

    const result = await telegram.broadcast('hello')
    expect(result).toEqual({ ok: true, sent: 2, failed: 0, errors: [] })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const sentChatIds = fetchMock.mock.calls.map(call => JSON.parse(call[1].body).chat_id).sort()
    expect(sentChatIds).toEqual(['111', '222'])
  })

  it('partial failure: still ok=true, failure recorded', async () => {
    await setSetting(KEYS.TELEGRAM_BOT_TOKEN, 'tok')
    await prisma.user.createMany({
      data: [
        { username: 'a', passwordHash: 'x:y', role: 'admin', telegramChatId: '111' },
        { username: 'b', passwordHash: 'x:y', role: 'member', telegramChatId: '222' },
      ],
    })
    fetchMock
      .mockResolvedValueOnce(okResponse({ ok: true }))
      .mockResolvedValueOnce(new Response('chat not found', { status: 400 }))

    const result = await telegram.broadcast('hello')
    expect(result.ok).toBe(true)
    expect(result.sent).toBe(1)
    expect(result.failed).toBe(1)
    expect(result.errors).toHaveLength(1)
  })

  it('no bound users → ok=false, no fetch', async () => {
    await setSetting(KEYS.TELEGRAM_BOT_TOKEN, 'tok')
    const result = await telegram.broadcast('hello')
    expect(result.ok).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('getBotUsername', () => {
  it('caches getMe across calls', async () => {
    await setSetting(KEYS.TELEGRAM_BOT_TOKEN, 'tok')
    fetchMock.mockResolvedValue(okResponse({ ok: true, result: { username: 'BillAlarmBot' } }))
    expect(await telegram.getBotUsername()).toBe('BillAlarmBot')
    expect(await telegram.getBotUsername()).toBe('BillAlarmBot')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @bill-alarm/server test -- src/services/__tests__/telegram.test.ts`
Expected: FAIL (`broadcast` / `getBotUsername` / `_resetTelegramCaches` not exported).

- [ ] **Step 3: Rewrite `apps/server/src/services/telegram.ts`**

The three message-format functions keep their message text EXACTLY as today (`formatAmount`/`formatDate`/`daysUntil` helpers and the string building are unchanged — copy those bodies verbatim from the current file); only the transport layer changes. New top section:

```ts
import type { Bill, Bank } from '../../generated/prisma/client.js'
import prisma from '@/prisma.js'
import { getSetting, KEYS } from './settings.js'

const API_BASE = 'https://api.telegram.org/bot'

async function getBotToken(): Promise<string | null> {
  return getSetting(KEYS.TELEGRAM_BOT_TOKEN)
}

async function sendRaw(token: string, chatId: string, text: string): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`${API_BASE}${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
  })
  if (!res.ok) {
    const err = await res.text()
    console.error(`[telegram] Send to ${chatId} failed: ${err}`)
    return { ok: false, error: err }
  }
  return { ok: true }
}

export async function sendMessage(chatId: string, text: string): Promise<boolean> {
  const token = await getBotToken()
  if (!token) {
    console.warn('[telegram] Bot token not configured, skipping message')
    return false
  }
  return (await sendRaw(token, chatId, text)).ok
}

export interface BroadcastResult {
  ok: boolean
  sent: number
  failed: number
  errors: string[]
}

/** Send to every bound user, deduplicating chat ids (two users in one group chat → one message). */
export async function broadcast(text: string): Promise<BroadcastResult> {
  const token = await getBotToken()
  if (!token) {
    console.warn('[telegram] Bot token not configured, skipping message')
    return { ok: false, sent: 0, failed: 0, errors: ['bot token not configured'] }
  }
  const users = await prisma.user.findMany({
    where: { telegramChatId: { not: null } },
    select: { telegramChatId: true },
  })
  const chatIds = [...new Set(users.map(u => u.telegramChatId!))]
  if (chatIds.length === 0) {
    console.warn('[telegram] No bound users, skipping message')
    return { ok: false, sent: 0, failed: 0, errors: ['no bound users'] }
  }
  const result: BroadcastResult = { ok: false, sent: 0, failed: 0, errors: [] }
  for (const chatId of chatIds) {
    const r = await sendRaw(token, chatId, text)
    if (r.ok) result.sent += 1
    else {
      result.failed += 1
      result.errors.push(`chat ${chatId}: ${r.error}`)
    }
  }
  result.ok = result.sent > 0
  return result
}

// --- Bot identity & updates (binding flow) ---

let cachedBotUsername: string | null = null

/** test-only */
export function _resetTelegramCaches(): void {
  cachedBotUsername = null
}

export async function getBotUsername(): Promise<string | null> {
  if (cachedBotUsername) return cachedBotUsername
  const token = await getBotToken()
  if (!token) return null
  const res = await fetch(`${API_BASE}${token}/getMe`)
  if (!res.ok) return null
  const body = await res.json() as { ok: boolean; result?: { username?: string } }
  cachedBotUsername = body.ok ? body.result?.username ?? null : null
  return cachedBotUsername
}

export interface TgUpdate {
  update_id: number
  message?: { text?: string; chat: { id: number } }
}

/** No offset commit: family-scale volume, Telegram expires updates after 24h. */
export async function getUpdates(): Promise<TgUpdate[]> {
  const token = await getBotToken()
  if (!token) return []
  const res = await fetch(`${API_BASE}${token}/getUpdates`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ timeout: 0, allowed_updates: ['message'] }),
  })
  if (!res.ok) return []
  const body = await res.json() as { ok: boolean; result?: TgUpdate[] }
  return body.ok ? body.result ?? [] : []
}
```

Then the unchanged format helpers and the senders (only the final send call and signatures change; `getConfig()` is deleted):

```ts
export async function sendNewBillAlert(bill: Bill, bank: Bank): Promise<BroadcastResult> {
  // ...`lines` built exactly as in the current file...
  return broadcast(lines.join('\n'))
}

export async function sendBillReminder(bill: Bill, bank: Bank): Promise<BroadcastResult> {
  // ...`text` built exactly as in the current file...
  return broadcast(text)
}

export async function sendOverdueWarning(bill: Bill, bank: Bank): Promise<BroadcastResult> {
  // ...`text` built exactly as in the current file...
  return broadcast(text)
}

export async function sendTestMessage(chatId: string): Promise<boolean> {
  return sendMessage(chatId, '🔔 Bill Alarm 測試訊息\n\n連線成功！通知功能正常運作。')
}

export async function isConfigured(): Promise<boolean> {
  return !!(await getBotToken())
}
```

- [ ] **Step 4: Update `apps/server/src/services/notification.ts` call sites**

`processNewBill` telegram block:

```ts
  const r = await sendNewBillAlert(bill, bank)
  await logNotification(bill.id, null, 'telegram', '新帳單通知', r.ok, r.failed > 0 ? r.errors.join('; ') : undefined)
  logger.info({ bank: bank.name, sent: r.sent, failed: r.failed }, 'Telegram notification sent')
```

`processReminderRules` channel loop:

```ts
      for (const channel of channels) {
        try {
          if (channel === 'telegram') {
            const r = await sendBillReminder(bill, bill.bank)
            await logNotification(bill.id, rule.id, channel, rule.name, r.ok, r.failed > 0 ? r.errors.join('; ') : undefined)
          }
        } catch (e) {
          await logNotification(bill.id, rule.id, channel, rule.name, false, (e as Error).message)
        }
      }
```

`processOverdueBills` send block:

```ts
    const r = await sendOverdueWarning(bill, bill.bank)
    await logNotification(bill.id, null, 'telegram', '逾期警告', r.ok, r.failed > 0 ? r.errors.join('; ') : undefined)
```

- [ ] **Step 5: Update settings, system, config**

`apps/server/src/services/settings.ts`: delete the line `[KEYS.TELEGRAM_CHAT_ID]: 'TELEGRAM_CHAT_ID',` from `ENV_MAP`.

`apps/server/src/routes/system.ts` — imports:

```ts
import { sendTestMessage, isConfigured as telegramConfigured } from '@/services/telegram.js'
import { getAuthUser } from './auth.js'
```

Replace the telegram test route:

```ts
// Telegram test — sends to the requester's own binding
app.post('/telegram/test', async (c) => {
  const authUser = getAuthUser(c)
  const user = await prisma.user.findUnique({ where: { id: authUser.id } })
  if (!user?.telegramChatId) return c.json({ error: '請先在帳號區綁定 Telegram' }, 400)
  const success = await sendTestMessage(user.telegramChatId)
  return c.json({ success })
})
```

`apps/server/src/routes/config.ts` — add `import prisma from '@/prisma.js'`, then:

```ts
// Save Telegram config (bot token only; chat ids live on users now)
app.post('/telegram', zValidator('json', z.object({
  botToken: z.string().min(1),
})), async (c) => {
  await setSetting(KEYS.TELEGRAM_BOT_TOKEN, c.req.valid('json').botToken)
  return c.json({ success: true })
})
```

In `GET /status`: remove the `getSetting(KEYS.TELEGRAM_CHAT_ID)` entry from the `Promise.all` reads and the `chatId` destructure, delete the now-unused `mask()` helper, and change the telegram section of the response to:

```ts
    telegram: {
      isConfigured: !!botToken,
      boundCount: await prisma.user.count({ where: { telegramChatId: { not: null } } }),
    },
```

- [ ] **Step 6: Run the full server suite**

Run: `pnpm --filter @bill-alarm/server test`
Expected: ALL PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/services/telegram.ts apps/server/src/services/notification.ts apps/server/src/services/settings.ts apps/server/src/routes/system.ts apps/server/src/routes/config.ts apps/server/src/services/__tests__/telegram.test.ts
git commit -m "feat(server): per-user telegram sends with broadcast fan-out, token-only config"
```

---

### Task 5: Telegram deep-link binding endpoints

**Files:**
- Create: `apps/server/src/services/telegram-binding.ts`
- Modify: `apps/server/src/routes/auth.ts` (three routes)
- Test: `apps/server/src/routes/__tests__/telegram-binding.test.ts` (new)

**Interfaces:**
- Consumes: `getBotUsername`, `getUpdates`, `TgUpdate` (Task 4); `getAuthUser` (Task 1).
- Produces (frontend Task 8 relies on):
  - `POST /api/auth/telegram/bind` → 200 `{ deepLink, expiresAt }` / 400 `{ error: '尚未設定 Telegram Bot Token' }`
  - `POST /api/auth/telegram/confirm` → 200 `{ ok: true }` / 404 `{ error: '還沒收到 Start，請先在 Telegram 按 Start 再試' }` / 410 `{ error: '綁定連結已過期，請重新產生' }`
  - `DELETE /api/auth/telegram` → `{ ok: true }`
  - Service: `createBindCode(userId): { code: string; expiresAt: Date }`, `confirmBind(userId): Promise<ConfirmResult>`, `_resetBindCodes(): void`

- [ ] **Step 1: Write the failing tests**

Create `apps/server/src/routes/__tests__/telegram-binding.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setupTestDb } from '../../services/__tests__/helpers/test-db.js'

setupTestDb()
process.env.LOG_LEVEL = 'silent'

const { default: app } = await import('@/index.js')
const { default: prisma } = await import('@/prisma.js')
const { setSetting, KEYS } = await import('@/services/settings.js')
const { _resetTelegramCaches } = await import('@/services/telegram.js')
const { _resetBindCodes } = await import('@/services/telegram-binding.js')

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

function okResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 })
}

function cookieOf(res: Response): string {
  return res.headers.get('set-cookie')?.split(';')[0] ?? ''
}

const setup = await app.request('/api/auth/setup', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'boss', password: 'admin-password' }),
})
const cookie = cookieOf(setup)

beforeEach(() => {
  fetchMock.mockReset()
  _resetTelegramCaches()
  _resetBindCodes()
})

describe('telegram binding', () => {
  it('bind without bot token → 400', async () => {
    const res = await app.request('/api/auth/telegram/bind', { method: 'POST', headers: { Cookie: cookie } })
    expect(res.status).toBe(400)
  })

  it('bind → deep link; confirm matches /start <code> and stores chat id; unbind clears it', async () => {
    await setSetting(KEYS.TELEGRAM_BOT_TOKEN, 'tok')
    fetchMock.mockResolvedValueOnce(okResponse({ ok: true, result: { username: 'BillAlarmBot' } })) // getMe

    const bind = await app.request('/api/auth/telegram/bind', { method: 'POST', headers: { Cookie: cookie } })
    expect(bind.status).toBe(200)
    const { deepLink } = await bind.json()
    expect(deepLink).toMatch(/^https:\/\/t\.me\/BillAlarmBot\?start=[0-9a-f]{16}$/)
    const code = deepLink.split('start=')[1]

    fetchMock.mockResolvedValueOnce(okResponse({
      ok: true,
      result: [
        { update_id: 1, message: { text: 'hello', chat: { id: 5 } } },
        { update_id: 2, message: { text: `/start ${code}`, chat: { id: 424242 } } },
      ],
    })) // getUpdates
    const confirm = await app.request('/api/auth/telegram/confirm', { method: 'POST', headers: { Cookie: cookie } })
    expect(confirm.status).toBe(200)

    const user = await prisma.user.findUnique({ where: { username: 'boss' } })
    expect(user!.telegramChatId).toBe('424242')

    const me = await app.request('/api/auth/me', { headers: { Cookie: cookie } })
    expect((await me.json()).telegramBound).toBe(true)

    const unbind = await app.request('/api/auth/telegram', { method: 'DELETE', headers: { Cookie: cookie } })
    expect(unbind.status).toBe(200)
    const after = await prisma.user.findUnique({ where: { username: 'boss' } })
    expect(after!.telegramChatId).toBeNull()
  })

  it('confirm without a Start message → 404; confirm without an outstanding code → 410', async () => {
    await setSetting(KEYS.TELEGRAM_BOT_TOKEN, 'tok')
    fetchMock.mockResolvedValueOnce(okResponse({ ok: true, result: { username: 'BillAlarmBot' } }))
    await app.request('/api/auth/telegram/bind', { method: 'POST', headers: { Cookie: cookie } })

    fetchMock.mockResolvedValueOnce(okResponse({ ok: true, result: [] })) // getUpdates: nothing yet
    const notSeen = await app.request('/api/auth/telegram/confirm', { method: 'POST', headers: { Cookie: cookie } })
    expect(notSeen.status).toBe(404)

    _resetBindCodes()
    const noCode = await app.request('/api/auth/telegram/confirm', { method: 'POST', headers: { Cookie: cookie } })
    expect(noCode.status).toBe(410)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @bill-alarm/server test -- src/routes/__tests__/telegram-binding.test.ts`
Expected: FAIL (module `telegram-binding` missing, routes 404).

- [ ] **Step 3: Implement `apps/server/src/services/telegram-binding.ts`**

```ts
import { randomBytes } from 'node:crypto'
import prisma from '@/prisma.js'
import { getUpdates } from './telegram.js'

const CODE_TTL_MS = 10 * 60 * 1000

interface PendingBind {
  code: string
  expiresAt: number
}

// One outstanding code per user; in-memory is fine (single process, short TTL).
const pending = new Map<string, PendingBind>()

/** test-only */
export function _resetBindCodes(): void {
  pending.clear()
}

export function createBindCode(userId: string): { code: string; expiresAt: Date } {
  for (const [uid, entry] of pending) {
    if (entry.expiresAt < Date.now()) pending.delete(uid)
  }
  const code = randomBytes(8).toString('hex') // 16 hex chars — valid t.me start payload
  const expiresAt = Date.now() + CODE_TTL_MS
  pending.set(userId, { code, expiresAt })
  return { code, expiresAt: new Date(expiresAt) }
}

export type ConfirmResult =
  | { status: 'ok'; chatId: string }
  | { status: 'no_code' }
  | { status: 'not_seen' }

export async function confirmBind(userId: string): Promise<ConfirmResult> {
  const entry = pending.get(userId)
  if (!entry || entry.expiresAt < Date.now()) {
    pending.delete(userId)
    return { status: 'no_code' }
  }
  const updates = await getUpdates()
  const match = [...updates].reverse().find(u => u.message?.text === `/start ${entry.code}`)
  if (!match?.message) return { status: 'not_seen' }
  const chatId = String(match.message.chat.id)
  await prisma.user.update({ where: { id: userId }, data: { telegramChatId: chatId } })
  pending.delete(userId)
  return { status: 'ok', chatId }
}
```

- [ ] **Step 4: Add the routes to `apps/server/src/routes/auth.ts`**

Imports to add:

```ts
import { getBotUsername } from '@/services/telegram.js'
import { createBindCode, confirmBind } from '@/services/telegram-binding.js'
```

Routes (place after `/password`, before `authGuard`):

```ts
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
```

- [ ] **Step 5: Run the full server suite**

Run: `pnpm --filter @bill-alarm/server test`
Expected: ALL PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/services/telegram-binding.ts apps/server/src/routes/auth.ts apps/server/src/routes/__tests__/telegram-binding.test.ts
git commit -m "feat(server): telegram deep-link binding (bind/confirm/unbind)"
```

---

### Task 6: Web — role state, 403 toast, role-filtered navigation

**Files:**
- Modify: `apps/web/composables/useAuth.ts`
- Modify: `apps/web/composables/useApi.ts`
- Modify: `apps/web/composables/useNavItems.ts`
- Modify: `apps/web/app.vue`

**Interfaces:**
- Consumes: `GET /api/auth/me` → `{ username, role, telegramBound }` (Task 1).
- Produces (Tasks 7–8 rely on): `useMe(): Ref<MeInfo | null>`, `useAuth()` returning `{ authed, me, isAdmin, fetchMe, logout }` with `MeInfo = { username: string; role: 'admin' | 'member'; telegramBound: boolean }`; `useNavItems(): ComputedRef<NavItem[]>`.

- [ ] **Step 1: Rewrite `apps/web/composables/useAuth.ts`**

```ts
export interface MeInfo {
  username: string
  role: 'admin' | 'member'
  telegramBound: boolean
}

export const useAuthed = () => useState<boolean | null>('authed', () => null)
export const useMe = () => useState<MeInfo | null>('me', () => null)

export function useAuth() {
  const authed = useAuthed()
  const me = useMe()
  const isAdmin = computed(() => me.value?.role === 'admin')

  async function fetchMe(): Promise<void> {
    me.value = await $fetch<MeInfo>('/api/auth/me').catch(() => null)
  }

  async function logout(): Promise<void> {
    try {
      await $fetch('/api/auth/logout', { method: 'POST' })
    }
    catch {
      // ignore — local state is cleared and user is redirected regardless
    }
    finally {
      authed.value = false
      me.value = null
      await navigateTo('/login')
    }
  }

  return { authed, me, isAdmin, fetchMe, logout }
}
```

- [ ] **Step 2: Add 403 handling in `apps/web/composables/useApi.ts`**

Add the import and the `else if` branch (rest of the file unchanged):

```ts
import { toast } from 'vue-sonner'

export function useApi() {
  const baseURL = '/api'

  const apiFetch = $fetch.create({
    onResponseError({ response }) {
      if (response.status === 401) {
        useAuthed().value = false
        navigateTo('/login')
      }
      else if (response.status === 403) {
        toast.error('權限不足')
      }
    },
  })
```

- [ ] **Step 3: Role-filter `apps/web/composables/useNavItems.ts`**

Full replacement:

```ts
import type { Component, ComputedRef } from 'vue'
import { CreditCard, History, LayoutDashboard, Receipt, Settings } from 'lucide-vue-next'

export interface NavItem {
  to: string
  label: string
  icon: Component
}

const ALL_ITEMS: NavItem[] = [
  { to: '/', label: '總覽', icon: LayoutDashboard },
  { to: '/bills', label: '帳單', icon: Receipt },
  { to: '/banks', label: '銀行', icon: CreditCard },
  { to: '/scan-logs', label: '紀錄', icon: History },
  { to: '/settings', label: '設定', icon: Settings },
]

// Members don't manage banks; while `me` is still loading (null) show the full
// set so the admin doesn't see tabs pop in on first paint.
export function useNavItems(): ComputedRef<NavItem[]> {
  const me = useMe()
  return computed(() =>
    me.value?.role === 'member' ? ALL_ITEMS.filter(i => i.to !== '/banks') : ALL_ITEMS,
  )
}
```

- [ ] **Step 4: Load `me` from the shell — `apps/web/app.vue` script**

Replace the script's nav/title section with:

```ts
const route = useRoute()
const bareShell = computed(() => route.path === '/login' || route.path === '/setup')

const { me, fetchMe } = useAuth()
onMounted(() => {
  if (!bareShell.value) fetchMe()
})
// After login/setup the route flips bare→shell; fetch the profile then.
watch(bareShell, (bare) => {
  if (!bare && !me.value) fetchMe()
})

const navItems = useNavItems()

const pageTitle = computed(() => {
  const hit = navItems.value.find(item =>
    item.to === '/' ? route.path === '/' : route.path.startsWith(item.to),
  )
  return hit?.label ?? 'Bill Alarm'
})
```

(Template unchanged — `v-for="item in navItems"` auto-unwraps the computed. `BottomNav.vue` needs no change for the same reason.)

- [ ] **Step 5: Verify build**

Run: `pnpm --filter @bill-alarm/web generate`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add apps/web/composables/useAuth.ts apps/web/composables/useApi.ts apps/web/composables/useNavItems.ts apps/web/app.vue
git commit -m "feat(web): role-aware auth state, 403 toast, member nav filtering"
```

---

### Task 7: Web — member gating on bills, unpay, change-password dialog

**Files:**
- Modify: `apps/web/composables/useBillApi.ts`
- Modify: `apps/web/pages/bills/[id].vue`
- Create: `apps/web/components/settings/ChangePasswordDialog.vue`
- Modify: `apps/web/pages/settings/index.vue` (account card only — the settings restructure is Task 8; this task only adds the 修改密碼 button + dialog wiring)

**Interfaces:**
- Consumes: `isAdmin` (Task 6), `POST /api/bills/:id/unpay` (Task 2), `POST /api/auth/password` (Task 1).
- Produces: `useBillApi().unpay(id)`; `<SettingsChangePasswordDialog v-model:open="...">`.

- [ ] **Step 1: Add `unpay` to `apps/web/composables/useBillApi.ts`**

Below `markAsPaid`:

```ts
    unpay: (id: string) => post<any>(`/bills/${id}/unpay`),
```

- [ ] **Step 2: Gate admin-only actions in `apps/web/pages/bills/[id].vue`**

Script: add `const { isAdmin } = useAuth()`, destructure `unpay`, and switch the revert handler to it:

```ts
const { getById, markAsPaid, update, reparse, remove, unpay } = useBillApi()
```

```ts
async function handleRevertToPending() {
  actionLoading.value = true
  try {
    await unpay(billId.value)
    toast.success('帳單已恢復為待繳')
    await fetchBill()
  } catch {
    toast.error('操作失敗', { description: '無法恢復帳單狀態，請稍後再試' })
  } finally {
    actionLoading.value = false
  }
}
```

Template gating (admin-only controls):
- 編輯 button: `v-if="!editing"` → `v-if="!editing && isAdmin"`
- 刪除 (Trash2) button: `v-if="!editing"` → `v-if="!editing && isAdmin"`
- AI 重新解析 button: `v-if="bill.pdfPath"` → `v-if="bill.pdfPath && isAdmin"`

(標記已繳 and 恢復為待繳 stay for both roles.)

- [ ] **Step 3: Create `apps/web/components/settings/ChangePasswordDialog.vue`**

```vue
<script setup lang="ts">
import { toast } from 'vue-sonner'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ 'update:open': [value: boolean] }>()

const { post } = useApi()

const form = ref({ current: '', next: '', confirm: '' })
const submitting = ref(false)

watch(() => props.open, (open) => {
  if (open) form.value = { current: '', next: '', confirm: '' }
})

async function submit() {
  if (form.value.next.length < 8) {
    toast.error('新密碼至少 8 碼')
    return
  }
  if (form.value.next !== form.value.confirm) {
    toast.error('兩次輸入的新密碼不一致')
    return
  }
  submitting.value = true
  try {
    await post('/auth/password', {
      currentPassword: form.value.current,
      newPassword: form.value.next,
    })
    toast.success('密碼已更新', { description: '其他裝置需重新登入。' })
    emit('update:open', false)
  } catch (e: any) {
    toast.error('修改失敗', { description: e?.data?.error ?? String(e) })
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent class="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>修改密碼</DialogTitle>
        <DialogDescription>修改後其他已登入的裝置會被登出。</DialogDescription>
      </DialogHeader>
      <form class="space-y-3" @submit.prevent="submit">
        <div class="space-y-2">
          <Label for="pwCurrent">目前密碼</Label>
          <Input id="pwCurrent" v-model="form.current" type="password" autocomplete="current-password" required />
        </div>
        <div class="space-y-2">
          <Label for="pwNext">新密碼</Label>
          <Input id="pwNext" v-model="form.next" type="password" autocomplete="new-password" required />
        </div>
        <div class="space-y-2">
          <Label for="pwConfirm">確認新密碼</Label>
          <Input id="pwConfirm" v-model="form.confirm" type="password" autocomplete="new-password" required />
        </div>
        <DialogFooter class="gap-2 sm:gap-0">
          <DialogClose as-child><Button type="button" variant="outline">取消</Button></DialogClose>
          <Button type="submit" :disabled="submitting">{{ submitting ? '儲存中...' : '儲存' }}</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
```

- [ ] **Step 4: Wire the dialog into the account card in `apps/web/pages/settings/index.vue`**

Script additions: `const changePwOpen = ref(false)`, and add `KeyRound` to the lucide-vue-next import.

In the account `Card`, replace the standalone logout `Button` with a two-button group:

```vue
        <div class="flex items-center gap-2">
          <Button variant="outline" size="sm" @click="changePwOpen = true">
            <KeyRound class="mr-2 h-4 w-4" />
            修改密碼
          </Button>
          <Button
            variant="outline" size="sm"
            class="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
            @click="logout"
          >
            <LogOut class="mr-2 h-4 w-4" />
            登出
          </Button>
        </div>
```

Next to the existing dialogs at the bottom:

```vue
    <SettingsChangePasswordDialog v-model:open="changePwOpen" />
```

- [ ] **Step 5: Verify build**

Run: `pnpm --filter @bill-alarm/web generate`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add apps/web/composables/useBillApi.ts apps/web/pages/bills/[id].vue apps/web/components/settings/ChangePasswordDialog.vue apps/web/pages/settings/index.vue
git commit -m "feat(web): member gating on bill actions, unpay flow, change password dialog"
```

---

### Task 8: Web — settings restructure, Telegram binding card, users management

**Files:**
- Create: `apps/web/components/settings/TelegramBindCard.vue`
- Create: `apps/web/components/settings/UsersCard.vue`
- Create: `apps/web/composables/useUsersApi.ts`
- Modify: `apps/web/components/settings/IntegrationTelegram.vue` (token-only)
- Modify: `apps/web/composables/useSettingsApi.ts`
- Modify: `apps/web/types/settings.ts`
- Modify: `apps/web/pages/settings/index.vue` (role variants)

**Interfaces:**
- Consumes: Task 5 binding endpoints, Task 3 users API, Task 4 config shape, `useAuth` (Task 6).
- Produces: final settings page. Member sees: 安裝 App、Telegram 綁定、行事曆訂閱、帳號. Admin additionally sees 服務整合、通知規則、使用者管理.

- [ ] **Step 1: API composable updates**

`apps/web/composables/useSettingsApi.ts`:
- `getConfigStatus` type: `telegram: { isConfigured: boolean; boundCount: number }`
- `saveTelegramConfig: (botToken: string) => post<{ success: boolean }>('/config/telegram', { botToken })`
- Add:

```ts
    // Telegram per-user binding
    telegramBind: () => post<{ deepLink: string; expiresAt: string }>('/auth/telegram/bind'),
    telegramConfirm: () => post<{ ok: boolean }>('/auth/telegram/confirm'),
    telegramUnbind: () => del<{ ok: boolean }>('/auth/telegram'),
```

`apps/web/types/settings.ts`: `telegram: { isConfigured: boolean; chatId: string | null }` → `telegram: { isConfigured: boolean; boundCount: number }`.

Create `apps/web/composables/useUsersApi.ts`:

```ts
export interface UserDTO {
  id: string
  username: string
  role: 'admin' | 'member'
  telegramBound: boolean
  createdAt: string
}

export function useUsersApi() {
  const { get, post, del } = useApi()
  return {
    list: () => get<UserDTO[]>('/users'),
    create: (username: string, password: string) => post<UserDTO>('/users', { username, password }),
    resetPassword: (id: string, password: string) => post<{ ok: boolean }>(`/users/${id}/reset-password`, { password }),
    remove: (id: string) => del<{ ok: boolean }>(`/users/${id}`),
  }
}
```

- [ ] **Step 2: Create `apps/web/components/settings/TelegramBindCard.vue`**

```vue
<script setup lang="ts">
import { CheckCircle, ExternalLink, Send } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'

const settingsApi = useSettingsApi()
const { me, fetchMe } = useAuth()

const deepLink = ref<string | null>(null)
const working = ref(false)

async function startBind() {
  working.value = true
  try {
    const res = await settingsApi.telegramBind()
    deepLink.value = res.deepLink
  } catch (e: any) {
    toast.error('無法產生綁定連結', { description: e?.data?.error ?? String(e) })
  } finally {
    working.value = false
  }
}

async function confirmBind() {
  working.value = true
  try {
    await settingsApi.telegramConfirm()
    deepLink.value = null
    await fetchMe()
    toast.success('Telegram 綁定成功', { description: '之後的帳單通知會發送給你。' })
  } catch (e: any) {
    toast.error('綁定尚未完成', { description: e?.data?.error ?? String(e) })
  } finally {
    working.value = false
  }
}

async function unbind() {
  working.value = true
  try {
    await settingsApi.telegramUnbind()
    await fetchMe()
    toast.success('已解除 Telegram 綁定')
  } catch (e: any) {
    toast.error('解除綁定失敗', { description: e?.data?.error ?? String(e) })
  } finally {
    working.value = false
  }
}
</script>

<template>
  <Card class="space-y-3 p-4">
    <div class="flex items-center gap-3">
      <Send class="h-5 w-5 shrink-0 text-muted-foreground" />
      <div class="min-w-0 flex-1">
        <p class="text-sm font-medium">Telegram 通知</p>
        <p class="text-xs text-muted-foreground">
          {{ me?.telegramBound ? '已綁定，帳單通知會發送給你' : '綁定後，帳單通知會發送給你' }}
        </p>
      </div>
      <CheckCircle v-if="me?.telegramBound" class="h-4 w-4 shrink-0 text-green-500" />
    </div>

    <!-- Bound -->
    <div v-if="me?.telegramBound" class="flex justify-end">
      <Button size="sm" variant="ghost" :disabled="working" @click="unbind">解除綁定</Button>
    </div>

    <!-- Unbound, link generated: two-step guide -->
    <div v-else-if="deepLink" class="space-y-2 rounded-lg border border-border p-3">
      <p class="text-xs text-muted-foreground">1. 開啟 Telegram 並按下 <b>Start</b>；2. 回到這裡按「完成綁定」。</p>
      <div class="flex flex-wrap justify-end gap-2">
        <Button size="sm" variant="outline" as="a" :href="deepLink" target="_blank" rel="noopener">
          <ExternalLink class="mr-2 h-4 w-4" />
          開啟 Telegram
        </Button>
        <Button size="sm" :disabled="working" @click="confirmBind">完成綁定</Button>
      </div>
    </div>

    <!-- Unbound, initial -->
    <div v-else class="flex justify-end">
      <Button size="sm" :disabled="working" @click="startBind">綁定 Telegram</Button>
    </div>
  </Card>
</template>
```

- [ ] **Step 3: Create `apps/web/components/settings/UsersCard.vue`**

```vue
<script setup lang="ts">
import { KeyRound, Plus, Trash2, Users } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import type { UserDTO } from '~/composables/useUsersApi'

const usersApi = useUsersApi()

const users = ref<UserDTO[]>([])
const loading = ref(true)
const submitting = ref(false)

const createOpen = ref(false)
const createForm = ref({ username: '', password: '' })
const resetTarget = ref<UserDTO | null>(null)
const resetPassword = ref('')
const deleteTarget = ref<UserDTO | null>(null)

async function fetchUsers() {
  loading.value = true
  try {
    users.value = await usersApi.list()
  } catch (e: any) {
    toast.error('載入使用者失敗', { description: e?.data?.error ?? String(e) })
  } finally {
    loading.value = false
  }
}

async function handleCreate() {
  if (createForm.value.password.length < 8) {
    toast.error('密碼至少 8 碼')
    return
  }
  submitting.value = true
  try {
    await usersApi.create(createForm.value.username, createForm.value.password)
    toast.success('帳號已建立')
    createOpen.value = false
    createForm.value = { username: '', password: '' }
    await fetchUsers()
  } catch (e: any) {
    toast.error('建立失敗', { description: e?.data?.error ?? String(e) })
  } finally {
    submitting.value = false
  }
}

async function handleReset() {
  if (!resetTarget.value) return
  if (resetPassword.value.length < 8) {
    toast.error('密碼至少 8 碼')
    return
  }
  submitting.value = true
  try {
    await usersApi.resetPassword(resetTarget.value.id, resetPassword.value)
    toast.success(`已重設 ${resetTarget.value.username} 的密碼`, { description: '該成員的所有裝置已被登出。' })
    resetTarget.value = null
    resetPassword.value = ''
  } catch (e: any) {
    toast.error('重設失敗', { description: e?.data?.error ?? String(e) })
  } finally {
    submitting.value = false
  }
}

async function handleDelete() {
  if (!deleteTarget.value) return
  submitting.value = true
  try {
    await usersApi.remove(deleteTarget.value.id)
    toast.success(`已刪除 ${deleteTarget.value.username}`)
    deleteTarget.value = null
    await fetchUsers()
  } catch (e: any) {
    toast.error('刪除失敗', { description: e?.data?.error ?? String(e) })
  } finally {
    submitting.value = false
  }
}

onMounted(fetchUsers)
</script>

<template>
  <Card class="space-y-3 p-4">
    <div class="flex items-center justify-between gap-3">
      <div class="flex items-center gap-3">
        <Users class="h-5 w-5 shrink-0 text-muted-foreground" />
        <div>
          <p class="text-sm font-medium">使用者管理</p>
          <p class="text-xs text-muted-foreground">為家人建立帳號，成員只能進行日常操作。</p>
        </div>
      </div>
      <Button size="sm" @click="createOpen = true">
        <Plus class="mr-1 h-4 w-4" />
        新增
      </Button>
    </div>

    <div v-if="loading" class="space-y-2">
      <div v-for="i in 2" :key="i" class="h-10 animate-pulse rounded-lg bg-muted" />
    </div>

    <div v-else class="space-y-2">
      <div
        v-for="user in users" :key="user.id"
        class="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-3 py-2"
      >
        <div class="flex min-w-0 items-center gap-2">
          <span class="truncate text-sm font-medium">{{ user.username }}</span>
          <Badge variant="secondary" class="text-[10px]">{{ user.role === 'admin' ? '管理者' : '成員' }}</Badge>
          <span class="text-xs text-muted-foreground">{{ user.telegramBound ? 'TG 已綁定' : 'TG 未綁定' }}</span>
        </div>
        <div class="flex items-center gap-1">
          <Button size="icon-sm" variant="ghost" title="重設密碼" @click="resetTarget = user; resetPassword = ''">
            <KeyRound class="h-4 w-4" />
          </Button>
          <Button
            v-if="user.role !== 'admin'"
            size="icon-sm" variant="ghost" title="刪除帳號"
            class="text-destructive hover:bg-destructive/10 hover:text-destructive"
            @click="deleteTarget = user"
          >
            <Trash2 class="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>

    <!-- Create dialog -->
    <Dialog :open="createOpen" @update:open="createOpen = $event">
      <DialogContent class="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>新增成員帳號</DialogTitle>
          <DialogDescription>把帳號密碼告訴家人，他們登入後可自行修改密碼。</DialogDescription>
        </DialogHeader>
        <form class="space-y-3" @submit.prevent="handleCreate">
          <div class="space-y-2">
            <Label for="newUsername">帳號</Label>
            <Input id="newUsername" v-model="createForm.username" autocomplete="off" required />
          </div>
          <div class="space-y-2">
            <Label for="newUserPw">初始密碼</Label>
            <Input id="newUserPw" v-model="createForm.password" type="password" autocomplete="new-password" required />
          </div>
          <DialogFooter class="gap-2 sm:gap-0">
            <DialogClose as-child><Button type="button" variant="outline">取消</Button></DialogClose>
            <Button type="submit" :disabled="submitting">建立</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>

    <!-- Reset password dialog -->
    <Dialog :open="!!resetTarget" @update:open="(v: boolean) => { if (!v) resetTarget = null }">
      <DialogContent class="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>重設密碼 — {{ resetTarget?.username }}</DialogTitle>
          <DialogDescription>重設後該成員所有裝置會被登出。</DialogDescription>
        </DialogHeader>
        <form class="space-y-3" @submit.prevent="handleReset">
          <div class="space-y-2">
            <Label for="resetPw">新密碼</Label>
            <Input id="resetPw" v-model="resetPassword" type="password" autocomplete="new-password" required />
          </div>
          <DialogFooter class="gap-2 sm:gap-0">
            <DialogClose as-child><Button type="button" variant="outline">取消</Button></DialogClose>
            <Button type="submit" :disabled="submitting">重設</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>

    <!-- Delete confirm dialog -->
    <Dialog :open="!!deleteTarget" @update:open="(v: boolean) => { if (!v) deleteTarget = null }">
      <DialogContent class="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>確認刪除</DialogTitle>
          <DialogDescription>確定要刪除「{{ deleteTarget?.username }}」嗎？其登入與 Telegram 綁定都會移除。</DialogDescription>
        </DialogHeader>
        <DialogFooter class="gap-2 sm:gap-0">
          <DialogClose as-child><Button variant="outline">取消</Button></DialogClose>
          <Button variant="destructive" :disabled="submitting" @click="handleDelete">確認刪除</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </Card>
</template>
```

- [ ] **Step 4: Token-only `apps/web/components/settings/IntegrationTelegram.vue`**

Full replacement:

```vue
<script setup lang="ts">
import { CheckCircle, ChevronDown, ChevronUp, Send } from 'lucide-vue-next'
import { toast } from 'vue-sonner'

const props = defineProps<{
  status: { isConfigured: boolean; boundCount: number }
}>()

const emit = defineEmits<{ refresh: [] }>()

const settingsApi = useSettingsApi()
const botToken = ref('')
const submitting = ref(false)
const testingTelegram = ref(false)
const showEditForm = ref(false)

async function handleSave() {
  if (!botToken.value) {
    toast.error('請填寫 Bot Token')
    return
  }
  submitting.value = true
  try {
    await settingsApi.saveTelegramConfig(botToken.value)
    toast.success('Telegram 設定已儲存')
    botToken.value = ''
    showEditForm.value = false
    emit('refresh')
  } catch (error) {
    toast.error('儲存失敗', { description: String(error) })
  } finally {
    submitting.value = false
  }
}

async function handleTest() {
  testingTelegram.value = true
  try {
    const result = await settingsApi.testTelegram()
    if (result.success) toast.success('測試訊息已發送', { description: '請檢查你的 Telegram。' })
    else toast.error('測試訊息發送失敗')
  } catch (e: any) {
    toast.error('發送失敗', { description: e?.data?.error ?? String(e) })
  } finally {
    testingTelegram.value = false
  }
}
</script>

<template>
  <div class="space-y-3">
    <!-- Not configured: token form -->
    <template v-if="!status.isConfigured">
      <p class="text-xs text-muted-foreground">
        透過 @BotFather 建立 Bot 取得 Token。每位成員在「帳號」區各自綁定接收通知。
      </p>
      <form class="space-y-3" @submit.prevent="handleSave">
        <div class="space-y-2">
          <Label for="tBotToken">Bot Token *</Label>
          <Input id="tBotToken" v-model="botToken" type="password" placeholder="123456:ABC-DEF..." />
        </div>
        <div class="flex justify-end">
          <Button type="submit" size="sm" :disabled="submitting">
            {{ submitting ? '儲存中...' : '儲存' }}
          </Button>
        </div>
      </form>
    </template>

    <!-- Configured -->
    <template v-else>
      <div class="flex items-center gap-2 text-sm">
        <CheckCircle class="h-4 w-4 text-green-500" />
        <span>Bot 已設定 · 已綁定 {{ status.boundCount }} 人</span>
      </div>
      <p v-if="status.boundCount === 0" class="text-xs text-yellow-500">
        目前沒有任何成員綁定，通知不會發送。請到「帳號」區綁定 Telegram。
      </p>
      <div class="flex gap-2">
        <Button size="sm" variant="outline" :disabled="testingTelegram" @click="handleTest">
          <Send class="mr-2 h-4 w-4" />
          {{ testingTelegram ? '發送中...' : '發送測試（給自己）' }}
        </Button>
        <Button size="sm" variant="ghost" @click="showEditForm = !showEditForm">
          修改 Token
          <component :is="showEditForm ? ChevronUp : ChevronDown" class="ml-1 h-4 w-4" />
        </Button>
      </div>

      <form v-if="showEditForm" class="space-y-3 rounded-lg border border-border p-3" @submit.prevent="handleSave">
        <div class="space-y-2">
          <Label for="tBotTokenEdit">Bot Token *</Label>
          <Input id="tBotTokenEdit" v-model="botToken" type="password" placeholder="輸入新的 Bot Token" />
        </div>
        <div class="flex justify-end gap-2">
          <Button type="button" size="sm" variant="ghost" @click="showEditForm = false; botToken = ''">
            取消
          </Button>
          <Button type="submit" size="sm" :disabled="submitting">
            {{ submitting ? '儲存中...' : '儲存' }}
          </Button>
        </div>
      </form>
    </template>
  </div>
</template>
```

- [ ] **Step 5: Role variants in `apps/web/pages/settings/index.vue`**

Script changes:
- Replace the local `me` ref and its `onMounted` `$fetch` with the global auth state:

```ts
const { me, isAdmin, logout } = useAuth()
```

- Admin data is fetched only for admins (members get 403 on `/config/status` and `/notification-rules`); replace `onMounted(fetchData)` with:

```ts
const adminDataFetched = ref(false)
watch(isAdmin, (admin) => {
  if (admin && !adminDataFetched.value) {
    adminDataFetched.value = true
    fetchData()
  }
}, { immediate: true })
```

- Member calendar feed (admins already see it inside 服務整合):

```ts
const memberFeedUrl = ref<string | null>(null)
watch(me, (m) => {
  if (m?.role === 'member' && !memberFeedUrl.value) {
    settingsApi.getCalendarFeed().then((f) => { memberFeedUrl.value = f.feedUrl }).catch(() => {})
  }
}, { immediate: true })

async function copyFeedUrl() {
  if (!memberFeedUrl.value) return
  await navigator.clipboard.writeText(memberFeedUrl.value)
  toast.success('已複製訂閱連結')
}
```

- Add `Copy` to the lucide-vue-next import (`CalendarCheck` is already imported).

Template changes:
- 服務整合 section: `<section class="space-y-3">` → `<section v-if="isAdmin" class="space-y-3">`
- 通知規則 section: `<section>` → `<section v-if="isAdmin">`
- In the 帳號 section, after `<InstallPrompt variant="row" />` insert:

```vue
      <SettingsTelegramBindCard />

      <!-- Member-only calendar subscription (admins have it in 服務整合) -->
      <Card v-if="!isAdmin && memberFeedUrl" class="flex flex-wrap items-center justify-between gap-3 p-4">
        <div class="flex min-w-0 items-center gap-3">
          <CalendarCheck class="h-5 w-5 shrink-0 text-muted-foreground" />
          <div class="min-w-0">
            <p class="text-sm font-medium">行事曆訂閱</p>
            <p class="truncate text-xs text-muted-foreground">{{ memberFeedUrl }}</p>
          </div>
        </div>
        <Button variant="outline" size="sm" @click="copyFeedUrl">
          <Copy class="mr-2 h-4 w-4" />
          複製連結
        </Button>
      </Card>
```

- In the account card's identity block, show the role:

```vue
            <p class="truncate text-xs text-muted-foreground">
              {{ me?.username ?? '—' }}
              <span v-if="me"> · {{ me.role === 'admin' ? '管理者' : '成員' }}</span>
            </p>
```

- After the account card, add:

```vue
      <SettingsUsersCard v-if="isAdmin" />
```

- Add `v-if="isAdmin"` to `<SettingsNotificationRuleDialog ...>` (the delete-confirmation Dialog stays as is — it only opens from admin UI).

- [ ] **Step 6: Verify build**

Run: `pnpm --filter @bill-alarm/web generate`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add apps/web/components/settings apps/web/composables/useUsersApi.ts apps/web/composables/useSettingsApi.ts apps/web/types/settings.ts apps/web/pages/settings/index.vue
git commit -m "feat(web): role-based settings, telegram bind card, users management"
```

---

### Task 9: README recovery update + full verification

**Files:**
- Modify: `README.md` (auth recovery section)

- [ ] **Step 1: Update the recovery commands**

In `README.md`, find the auth recovery section (it contains `DELETE FROM settings WHERE key IN ('auth_username','auth_password_hash')`). Replace the SQL in BOTH the host-side `sqlite3` command and the in-container fallback command with:

```sql
DELETE FROM users; DELETE FROM sessions;
```

so the host-side command becomes:

```bash
sqlite3 data/bill-alarm.db "DELETE FROM users; DELETE FROM sessions;"
```

Adjust the surrounding prose: wiping `users` returns the app to the first-run setup screen (all family accounts are removed; bills/banks/settings untouched). Also add one line to the deployment/upgrade notes: upgrading to this version logs everyone out once; if the Telegram chat id was configured via the `TELEGRAM_CHAT_ID` env var (not the UI), that env var is no longer read — re-bind via 設定 → 帳號 → Telegram 通知 after upgrading.

- [ ] **Step 2: Full verification**

```bash
pnpm --filter @bill-alarm/server test
pnpm --filter @bill-alarm/web generate
```

Expected: all server tests pass; generate exit 0.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: recovery and upgrade notes for multi-user auth"
```
