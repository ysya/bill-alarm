# Symmetric Multi-Tenant (Per-User Isolation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert bill-alarm from shared-household data to fully symmetric per-user isolation: each user owns their mailbox, banks, bills, rules, scan logs, and calendar feed; admin additionally manages users and global infrastructure (LLM, Telegram bot, scan cadence). User deletion becomes soft (deactivate/restore/permanent).

**Architecture:** Expand-and-contract schema migration — Task 1 adds NULLABLE `userId` columns (+ backfill to admin) so the tree stays green while Tasks 2–6 scope each subsystem (mail/scan stack, authz inversion + tenant routes, bills, calendar/notifications, user lifecycle); Task 7 contracts to NOT NULL. Authorization flips from a member allow-list to a short ADMIN_ONLY list with row-level scoping in every handler.

**Tech Stack:** Hono, Prisma + SQLite, Zod, Vitest; Nuxt 4 SPA, shadcn-vue, vue-sonner.

**Spec:** `docs/superpowers/specs/2026-07-06-multi-tenant-design.md`

## Global Constraints

- Work on branch `feature/multi-tenant` (create from `main` before Task 1).
- Symmetric isolation: every data route scopes by `getAuthUser(c).id`; single-resource routes return **404** (not 403) when the id exists but belongs to someone else.
- `ADMIN_ONLY` surface is exactly: all `/api/users*`; `POST /api/config/llm|gemini|openai|telegram|scan`; `GET /api/config/status`; `POST /api/llm/test`. Everything else is available to every authenticated user, self-scoped.
- Soft delete: `User.deletedAt`; deactivate (= old delete button) sets it + revokes sessions; restore clears it; permanent delete only from deactivated state (else 400). Admin can be neither deactivated nor deleted.
- Deactivated enforcement: login → 401 `{ error: '此帳號已停用' }` after password verification, WITHOUT counting a lockout failure; `validateSession` treats `deletedAt != null` as invalid; cron skips; notifications silent (overdue status still flips); calendar feed token → 404.
- Notifications go ONLY to the bill owner (`bank.userId`) via `sendToUser`; unbound owner → `NotificationLog` row with `success=false`, reason `使用者未綁定 Telegram`. `broadcast()` is removed. The three message texts stay byte-identical.
- Settings keys migrated to the admin User row then deleted: `imap_host`, `imap_port`, `imap_user`, `imap_password`, `ics_feed_token`, `email_provider`. `ENV_MAP` drops `IMAP_HOST/IMAP_PORT/IMAP_USER/IMAP_PASSWORD/EMAIL_PROVIDER`. Global settings that REMAIN: `telegram_bot_token`, LLM keys/models, `scan_interval`, `scan_range_days`, `scan_gmail_query_extra`, `last_scan_at`, `app_base_url`.
- Sessions are NOT wiped — no re-login on upgrade. Admin's existing calendar subscription URL keeps working (token migrated to admin's `icsFeedToken`).
- `Bank.code` unique becomes `@@unique([userId, code])`.
- User-facing copy zh-TW; code/comments/commits English (conventional commits).
- After each server task: `pnpm --filter @bill-alarm/server test` passes. Web tasks: `pnpm --filter @bill-alarm/web generate` exits 0.
- Interim rule for Tasks 1–6: schema `userId` fields are OPTIONAL (`String?`) but ALL code paths that create tenant rows MUST set `userId`; Task 7 flips schema+DB to required.

---

### Task 1: Expand migration — tenancy columns, soft-delete fields, deactivation guards

**Files:**
- Modify: `apps/server/prisma/schema.prisma`
- Create: `apps/server/prisma/migrations/<timestamp>_tenancy_expand/migration.sql` (via `--create-only`, replace content)
- Modify: `apps/server/src/services/auth.ts` (validateSession deactivation guard)
- Modify: `apps/server/src/routes/auth.ts` (login deactivation guard)
- Test: `apps/server/src/services/__tests__/auth.test.ts`, `apps/server/src/routes/__tests__/auth-flow.test.ts`

**Interfaces:**
- Produces (later tasks rely on): `User` fields `imapHost: string|null, imapPort: number|null, imapUser: string|null, imapPassword: string|null, icsFeedToken: string|null (unique), deletedAt: Date|null`; nullable `userId` + `user` relation on `Bank`, `BankAccount`, `NotificationRule`, `ScanLog`; `banks` unique `(userId, code)`; login rejects deactivated with 401 `此帳號已停用`; `validateSession` invalid for deactivated.

- [ ] **Step 1: Update Prisma schema**

In `apps/server/prisma/schema.prisma`:

`User` model — add after `telegramChatId String?`:

```prisma
  imapHost       String?
  imapPort       Int?
  imapUser       String?
  imapPassword   String?
  icsFeedToken   String?   @unique
  deletedAt      DateTime?
```

and add to `User`'s relation list (after `sessions Session[]`):

```prisma
  banks             Bank[]
  bankAccounts      BankAccount[]
  notificationRules NotificationRule[]
  scanLogs          ScanLog[]
```

`BankAccount` — add after `note String?`:

```prisma
  userId    String?
  user      User?    @relation(fields: [userId], references: [id], onDelete: Cascade)
```

`Bank` — change `code String? @unique` to `code String?`, add after `bankAccount`:

```prisma
  userId              String?
  user                User?        @relation(fields: [userId], references: [id], onDelete: Cascade)
```

and add inside `Bank` above `@@map("banks")`:

```prisma
  @@unique([userId, code])
```

`NotificationRule` — add after `isActive`:

```prisma
  userId     String?
  user       User?             @relation(fields: [userId], references: [id], onDelete: Cascade)
```

`ScanLog` — add after `trigger`:

```prisma
  userId        String?
  user          User?     @relation(fields: [userId], references: [id], onDelete: Cascade)
```

- [ ] **Step 2: Create the migration**

```bash
cd apps/server
pnpm exec prisma migrate dev --name tenancy_expand --create-only
```

Inspect the generated SQL. It will rebuild the four tables (SQLite adds FKs by table-rebuild) and alter `users`. Keep the generated DDL as-is, but INSERT the data-migration statements at the positions shown below. The final file must be the generated DDL PLUS these blocks (positions: user-column adds first, then per-table rebuilds as generated, then the backfill/settings block LAST):

Append at the END of the generated file:

```sql
-- Backfill all existing tenant rows to the admin user
UPDATE "banks" SET "userId" = (SELECT "id" FROM "users" WHERE "role" = 'admin' LIMIT 1) WHERE "userId" IS NULL;
UPDATE "bank_accounts" SET "userId" = (SELECT "id" FROM "users" WHERE "role" = 'admin' LIMIT 1) WHERE "userId" IS NULL;
UPDATE "notification_rules" SET "userId" = (SELECT "id" FROM "users" WHERE "role" = 'admin' LIMIT 1) WHERE "userId" IS NULL;
UPDATE "scan_logs" SET "userId" = (SELECT "id" FROM "users" WHERE "role" = 'admin' LIMIT 1) WHERE "userId" IS NULL;

-- Move per-user infrastructure settings onto the admin user row
UPDATE "users" SET
  "imapHost" = (SELECT "value" FROM "settings" WHERE "key" = 'imap_host'),
  "imapPort" = CAST((SELECT "value" FROM "settings" WHERE "key" = 'imap_port') AS INTEGER),
  "imapUser" = (SELECT "value" FROM "settings" WHERE "key" = 'imap_user'),
  "imapPassword" = (SELECT "value" FROM "settings" WHERE "key" = 'imap_password'),
  "icsFeedToken" = (SELECT "value" FROM "settings" WHERE "key" = 'ics_feed_token')
WHERE "role" = 'admin';

DELETE FROM "settings" WHERE "key" IN ('imap_host', 'imap_port', 'imap_user', 'imap_password', 'ics_feed_token', 'email_provider');
```

Note: the generated rebuild of `banks` must contain `CREATE UNIQUE INDEX "banks_userId_code_key" ON "banks"("userId", "code")` and must NOT recreate `banks_code_key`. If the generator emitted anything different, align to the schema (the drift check in the next step will catch mismatches).

- [ ] **Step 3: Verify against a seeded dev DB, then apply**

```bash
cd apps/server
sqlite3 data/bill-alarm.db "INSERT OR REPLACE INTO settings (key, value, updatedAt) VALUES ('imap_host','imap.gmail.com',CURRENT_TIMESTAMP),('imap_port','993',CURRENT_TIMESTAMP),('imap_user','frank@gmail.com',CURRENT_TIMESTAMP),('imap_password','apppw',CURRENT_TIMESTAMP),('ics_feed_token','feedtok123',CURRENT_TIMESTAMP);"
sqlite3 data/bill-alarm.db "INSERT INTO users (id, username, passwordHash, role, createdAt, updatedAt) SELECT lower(hex(randomblob(16))), 'mig-admin', 'aa:bb', 'admin', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP WHERE NOT EXISTS (SELECT 1 FROM users WHERE role='admin');"
pnpm exec prisma migrate dev
sqlite3 data/bill-alarm.db "SELECT imapUser, imapPort, icsFeedToken FROM users WHERE role='admin'; SELECT count(*) FROM settings WHERE key LIKE 'imap%' OR key IN ('ics_feed_token','email_provider');"
```

Expected: `frank@gmail.com|993|feedtok123` and `0`.

Cleanup + regenerate client:

```bash
sqlite3 data/bill-alarm.db "DELETE FROM users; DELETE FROM sessions;"
pnpm exec prisma generate
```

- [ ] **Step 4: Write the failing deactivation tests**

(a) `apps/server/src/services/__tests__/auth.test.ts` — append inside `describe('sessions', ...)`:

```ts
  it('sessions of a deactivated user are invalid', async () => {
    const u = await prisma.user.create({
      data: { username: 'deact-user', passwordHash: 'x:y', role: 'member' },
    })
    const { token } = await createSession(u.id)
    expect((await validateSession(token)).valid).toBe(true)
    await prisma.user.update({ where: { id: u.id }, data: { deletedAt: new Date() } })
    expect((await validateSession(token)).valid).toBe(false)
  })
```

(b) `apps/server/src/routes/__tests__/auth-flow.test.ts` — append inside the describe:

```ts
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
```

(6 correct-password attempts: if deactivation consumed lockout budget, the 6th would be 429 — asserting 401 each time pins "no budget consumed".)

- [ ] **Step 5: Run to verify failure**

Run: `pnpm --filter @bill-alarm/server test -- src/services/__tests__/auth.test.ts src/routes/__tests__/auth-flow.test.ts`
Expected: FAIL (deactivated session still valid; login error message mismatch).

- [ ] **Step 6: Implement the guards**

`apps/server/src/services/auth.ts` — in `validateSession`, change the invalid check:

```ts
  if (!session || session.expiresAt.getTime() < Date.now() || session.user.deletedAt) {
    return { valid: false, extended: false, expiresAt: null, user: null }
  }
```

`apps/server/src/routes/auth.ts` — in `/login`, after the `ok` check block and BEFORE `failures.delete(username)`:

```ts
  if (user.deletedAt) {
    // Correct password on a deactivated account: reject without touching lockout state.
    return c.json({ error: '此帳號已停用' }, 401)
  }
```

- [ ] **Step 7: Full suite**

Run: `pnpm --filter @bill-alarm/server test`
Expected: ALL PASS (51 existing + 2 new = 53).

- [ ] **Step 8: Commit**

```bash
git add apps/server/prisma apps/server/src/services/auth.ts apps/server/src/routes/auth.ts apps/server/src/services/__tests__/auth.test.ts apps/server/src/routes/__tests__/auth-flow.test.ts
git commit -m "feat(server): tenancy expand migration, per-user infra columns, deactivation guards"
```

---

### Task 2: Per-user mailbox — email provider, scan stack, scheduler, SSE

**Files:**
- Modify: `apps/server/src/services/email/index.ts`
- Modify: `apps/server/src/services/email-parser.ts`
- Modify: `apps/server/src/services/scan-events.ts`
- Modify: `apps/server/src/services/scheduler.ts`
- Modify: `apps/server/src/services/settings.ts` (KEYS/ENV_MAP cleanup)
- Modify: `apps/server/src/routes/email.ts`
- Modify: `apps/server/src/routes/system.ts` (email/scan, scan-events, email/status, integrations/status, email/search, email/message/*)
- Test: `apps/server/src/services/__tests__/mailbox.test.ts` (new)

**Interfaces:**
- Consumes: `User.imap*` fields (Task 1), `getAuthUser` (existing).
- Produces (later tasks + web rely on):
  - `interface MailboxOwner { imapHost: string | null; imapPort: number | null; imapUser: string | null; imapPassword: string | null }`
  - `getEmailProviderFor(owner: MailboxOwner): EmailProvider | null` (sync; null when user/password missing)
  - `verifyConnectionFor(owner: MailboxOwner): Promise<{ connected: boolean; message: string; email?: string }>`
  - `scanAndProcessEmails(user: ScanUser, callbacks?)` / `runScanWithLog(trigger, user: ScanUser)` where `type ScanUser = { id: string } & MailboxOwner`
  - `ScanEvent` variants all gain `userId: string`; `eventVisibleTo(e: ScanEvent, userId: string): boolean` exported from scan-events
  - `listScannableUsers(): Promise<User[]>` exported from scheduler (imap configured AND `deletedAt: null`)
  - `GET /api/email/status` → `{ hasCredentials, connected, message, email?, host, port, user }` for the CURRENT user
  - `POST /api/email/save` / `POST /api/email/test` operate on the current user
  - `POST /api/email/scan` scans the current user's mailbox

- [ ] **Step 1: Write the failing tests**

Create `apps/server/src/services/__tests__/mailbox.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { setupTestDb } from './helpers/test-db.js'

setupTestDb()
process.env.LOG_LEVEL = 'silent'

const { default: prisma } = await import('@/prisma.js')
const { getEmailProviderFor } = await import('../email/index.js')
const { listScannableUsers } = await import('../scheduler.js')
const { eventVisibleTo } = await import('../scan-events.js')

describe('per-user mailbox', () => {
  it('getEmailProviderFor: null without credentials, instance with them, defaults applied', () => {
    expect(getEmailProviderFor({ imapHost: null, imapPort: null, imapUser: null, imapPassword: null })).toBeNull()
    expect(getEmailProviderFor({ imapHost: null, imapPort: null, imapUser: 'a@b.c', imapPassword: null })).toBeNull()
    const p = getEmailProviderFor({ imapHost: null, imapPort: null, imapUser: 'a@b.c', imapPassword: 'pw' })
    expect(p).not.toBeNull()
  })

  it('listScannableUsers: only configured, non-deactivated users', async () => {
    await prisma.user.createMany({
      data: [
        { username: 'cfg', passwordHash: 'x:y', role: 'admin', imapUser: 'a@b.c', imapPassword: 'pw' },
        { username: 'nocfg', passwordHash: 'x:y', role: 'member' },
        { username: 'gone', passwordHash: 'x:y', role: 'member', imapUser: 'g@b.c', imapPassword: 'pw', deletedAt: new Date() },
      ],
    })
    const users = await listScannableUsers()
    expect(users.map(u => u.username)).toEqual(['cfg'])
  })

  it('eventVisibleTo filters by userId', () => {
    const e = { type: 'start' as const, scanLogId: 'x', total: 1, trigger: 'manual' as const, userId: 'u1' }
    expect(eventVisibleTo(e, 'u1')).toBe(true)
    expect(eventVisibleTo(e, 'u2')).toBe(false)
  })

  it('scan without configured mailbox reports 信箱未設定 and scans nothing', async () => {
    const { scanAndProcessEmails } = await import('../email-parser.js')
    const u = await prisma.user.create({ data: { username: 'bare', passwordHash: 'x:y', role: 'member' } })
    const result = await scanAndProcessEmails({ id: u.id, imapHost: null, imapPort: null, imapUser: null, imapPassword: null })
    expect(result.scanned).toBe(0)
    expect(result.errors[0].reason).toContain('信箱未設定')
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @bill-alarm/server test -- src/services/__tests__/mailbox.test.ts`
Expected: FAIL (missing exports / wrong signatures).

- [ ] **Step 3: Rewrite `apps/server/src/services/email/index.ts`**

```ts
import { GmailImapProvider } from './providers/gmail-imap.js'
import type { EmailProvider } from './types.js'

export type { EmailProvider, EmailMessage, Attachment, MessageRef, SearchOptions, VerifyResult } from './types.js'

export interface MailboxOwner {
  imapHost: string | null
  imapPort: number | null
  imapUser: string | null
  imapPassword: string | null
}

/** Build a provider from a user's own mailbox fields. Null until user+password are set. */
export function getEmailProviderFor(owner: MailboxOwner): EmailProvider | null {
  if (!owner.imapUser || !owner.imapPassword) return null
  return new GmailImapProvider({
    host: owner.imapHost || 'imap.gmail.com',
    port: owner.imapPort || 993,
    user: owner.imapUser,
    password: owner.imapPassword,
  })
}

export async function verifyConnectionFor(owner: MailboxOwner): Promise<{ connected: boolean; message: string; email?: string }> {
  const provider = getEmailProviderFor(owner)
  if (!provider) return { connected: false, message: '信箱尚未設定' }
  const result = await provider.verify()
  if (!result.ok) return { connected: false, message: `連線失敗：${result.error}` }
  return { connected: true, message: `已連線：${result.email}`, email: result.email }
}
```

(`getEmailProviderName`, `loadGmailImapConfig`, `getEmailProvider`, `isConfigured`, `verifyConnection` are deleted; this task updates every consumer.)

- [ ] **Step 4: Add userId to scan events — `apps/server/src/services/scan-events.ts`**

Add `userId: string` to all three `ScanEvent` variants (first field after `type`), and export the filter predicate at the bottom:

```ts
export function eventVisibleTo(e: ScanEvent, userId: string): boolean {
  return e.userId === userId
}
```

- [ ] **Step 5: Thread the user through `apps/server/src/services/email-parser.ts`**

Imports: replace `import { getEmailProvider } from './email/index.js'` with `import { getEmailProviderFor, type MailboxOwner } from './email/index.js'`.

Add near the top:

```ts
export type ScanUser = { id: string } & MailboxOwner
```

`scanAndProcessEmails` — new signature and the three changed regions (rest of the function body is untouched):

```ts
export async function scanAndProcessEmails(user: ScanUser, callbacks?: ScanCallbacks): Promise<ScanResult> {
  const result: ScanResult = { scanned: 0, newBills: [], errors: [] }

  const banks = await prisma.bank.findMany({ where: { isActive: true, userId: user.id } })
```

and the provider block:

```ts
  const provider = getEmailProviderFor(user)
  if (!provider) {
    result.errors.push({
      stage: 'email_search',
      reason: '信箱未設定（請至設定頁填入 IMAP 帳密）',
    })
    callbacks?.onStart?.(0)
    return result
  }
```

`runScanWithLog` — new signature; scan-log create gains userId; events gain userId; the inner call passes the user:

```ts
export async function runScanWithLog(trigger: 'manual' | 'cron', user: ScanUser): Promise<RecordedScan> {
  const log = await prisma.scanLog.create({
    data: { trigger, startedAt: new Date(), userId: user.id },
  })

  let result: ScanResult = { scanned: 0, newBills: [], errors: [] }
  let fatal: string | null = null
  try {
    result = await scanAndProcessEmails(user, {
      onStart: (total) => {
        scanEvents.emitEvent({ type: 'start', userId: user.id, scanLogId: log.id, total, trigger })
      },
      onProgress: (idx, total, bank, status, reason) => {
        scanEvents.emitEvent({ type: 'progress', userId: user.id, scanLogId: log.id, idx, total, bank, status, reason })
      },
    })
  } catch (e) {
    fatal = (e as Error).message ?? String(e)
    logger.error({ error: fatal }, 'Scan crashed unexpectedly')
  }
```

and the complete event:

```ts
  scanEvents.emitEvent({
    type: 'complete',
    userId: user.id,
    scanLogId: log.id,
    scanned: result.scanned,
    newBills: result.newBills.length,
    errorCount: result.errors.length,
  })
```

- [ ] **Step 6: Per-user cron loop — `apps/server/src/services/scheduler.ts`**

Add import `prisma from '@/prisma.js'` and export the helper; replace the scan cron body:

```ts
/** Users whose mailbox is configured and who are not deactivated. */
export async function listScannableUsers() {
  return prisma.user.findMany({
    where: { deletedAt: null, imapUser: { not: null }, imapPassword: { not: null } },
    orderBy: { createdAt: 'asc' },
  })
}
```

```ts
  cron.schedule('0 * * * *', async () => {
    if (!(await shouldScan())) return

    const users = await listScannableUsers()
    if (users.length === 0) return
    logger.info({ users: users.length }, 'Scanning emails for all configured users...')

    for (const user of users) {
      try {
        const { result, scanLogId } = await runScanWithLog('cron', user)
        logger.info({ user: user.username, scanned: result.scanned, newBills: result.newBills.length }, 'Email scan complete')

        const notifyErrors = []
        for (const { bill, bank } of result.newBills) {
          try {
            await processNewBill(bill, bank)
          } catch (e) {
            notifyErrors.push({
              stage: 'notification' as const,
              bank: bank.name,
              reason: `通知發送失敗：${(e as Error).message}`,
            })
          }
        }
        if (notifyErrors.length > 0) {
          await appendScanLogErrors(scanLogId, notifyErrors)
        }
        if (result.errors.length > 0 || notifyErrors.length > 0) {
          logger.warn({ user: user.username, errors: [...result.errors, ...notifyErrors] }, 'Email scan had errors')
        }
      } catch (err) {
        // One user's mailbox failing must not stop the others.
        logger.error({ user: user.username, err }, 'Email scan failed for user')
      }
    }
    await setSetting(KEYS.LAST_SCAN_AT, new Date().toISOString())
  })
```

(The reminder cron block stays unchanged.)

- [ ] **Step 7: Routes — `apps/server/src/routes/email.ts` full rewrite**

```ts
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import prisma from '@/prisma.js'
import { GmailImapProvider } from '@/services/email/providers/gmail-imap.js'
import { verifyConnectionFor } from '@/services/email/index.js'
import { getAuthUser } from './auth.js'

const app = new Hono()

const imapConfigSchema = z.object({
  host: z.string().min(1).default('imap.gmail.com'),
  port: z.number().int().min(1).max(65535).default(993),
  user: z.string().min(1),
  password: z.string().min(1),
})

// Test connection with provided IMAP credentials (does not save)
app.post('/test', zValidator('json', imapConfigSchema), async (c) => {
  const cfg = c.req.valid('json')
  const provider = new GmailImapProvider(cfg)
  const result = await provider.verify()
  return c.json(result)
})

// Save the CURRENT user's mailbox config
app.post('/save', zValidator('json', imapConfigSchema.extend({
  provider: z.literal('gmail-imap').default('gmail-imap'),
})), async (c) => {
  const { host, port, user, password } = c.req.valid('json')
  await prisma.user.update({
    where: { id: getAuthUser(c).id },
    data: { imapHost: host, imapPort: port, imapUser: user, imapPassword: password },
  })
  return c.json({ success: true })
})

// Current user's mailbox config + live connection status
app.get('/status', async (c) => {
  const me = await prisma.user.findUnique({ where: { id: getAuthUser(c).id } })
  if (!me) return c.json({ error: 'unauthorized' }, 401)
  const hasCredentials = !!(me.imapUser && me.imapPassword)
  const conn = hasCredentials
    ? await verifyConnectionFor(me)
    : { connected: false, message: '信箱尚未設定' }
  return c.json({
    hasCredentials,
    connected: conn.connected,
    message: conn.message,
    email: conn.email,
    host: me.imapHost || 'imap.gmail.com',
    port: me.imapPort || 993,
    user: me.imapUser,
  })
})

export default app
```

- [ ] **Step 8: Routes — `apps/server/src/routes/system.ts` scan/email surface**

Imports: replace `verifyConnection, getEmailProvider` import with `verifyConnectionFor, getEmailProviderFor` from `@/services/email/index.js`; add `eventVisibleTo` to the scan-events import.

Add a local helper under `const app = new Hono()`:

```ts
async function currentUser(c: Parameters<typeof getAuthUser>[0]) {
  return prisma.user.findUnique({ where: { id: getAuthUser(c).id } })
}
```

`GET /email/status` (this file's copy — kept for the overview widget, mount order makes it the effective handler):

```ts
app.get('/email/status', async (c) => {
  const me = await currentUser(c)
  if (!me) return c.json({ error: 'unauthorized' }, 401)
  const status = (me.imapUser && me.imapPassword)
    ? await verifyConnectionFor(me)
    : { connected: false, message: '信箱尚未設定' }
  return c.json(status)
})
```

`POST /email/scan` — fetch the caller and pass through:

```ts
app.post('/email/scan', async (c) => {
  const me = await currentUser(c)
  if (!me) return c.json({ error: 'unauthorized' }, 401)
  try {
    const { result, scanLogId } = await runScanWithLog('manual', me)
    // ...rest of the handler unchanged (notification loop + response)...
```

`GET /scan-events` — filter by the session user and only replay the caller's snapshot:

```ts
app.get('/scan-events', (c) => {
  const me = getAuthUser(c)
  return streamSSE(c, async (stream) => {
    let resolveDone: () => void = () => {}
    const done = new Promise<void>((r) => { resolveDone = r })

    const listener = (event: ScanEvent) => {
      if (!eventVisibleTo(event, me.id)) return
      stream
        .writeSSE({ event: event.type, data: JSON.stringify(event) })
        .catch(() => { /* client disconnected mid-write */ })
    }
    scanEvents.on('scan', listener)

    stream.onAbort(() => {
      scanEvents.off('scan', listener)
      resolveDone()
    })

    await stream.writeSSE({ event: 'hello', data: '{}' })

    const snapshot = scanEvents.getSnapshot()
    if (snapshot && eventVisibleTo(snapshot.start, me.id)) {
      await stream.writeSSE({ event: 'start', data: JSON.stringify(snapshot.start) })
      if (snapshot.progress) {
        await stream.writeSSE({ event: 'progress', data: JSON.stringify(snapshot.progress) })
      }
    }
    // ...heartbeat + await done unchanged...
```

`GET /integrations/status`:

```ts
app.get('/integrations/status', async (c) => {
  const me = await currentUser(c)
  const email = (me?.imapUser && me?.imapPassword)
    ? await verifyConnectionFor(me)
    : { connected: false, message: '信箱尚未設定' }
  return c.json({
    email: { connected: email.connected, message: email.message },
    telegram: { configured: await telegramConfigured() },
  })
})
```

`GET /email/search`, `GET /email/message/:id`, `GET /email/message/:id/parse` — each replaces its provider acquisition with:

```ts
  const me = await currentUser(c)
  const provider = me ? getEmailProviderFor(me) : null
  if (!provider) return c.json({ error: 'Email provider not configured' }, 400)
```

(the rest of each handler is unchanged).

- [ ] **Step 9: settings.ts cleanup**

In `apps/server/src/services/settings.ts` delete from `KEYS`: `EMAIL_PROVIDER`, `IMAP_HOST`, `IMAP_PORT`, `IMAP_USER`, `IMAP_PASSWORD`, `ICS_FEED_TOKEN` (and the `getOrCreateIcsFeedToken`/`rotateIcsFeedToken` functions ONLY IF nothing still imports them — `config.ts` and `calendar-feed.ts` still do until Tasks 4–5, so in THIS task delete only the five mail keys from `KEYS` and their `ENV_MAP` lines, keep `ICS_FEED_TOKEN` + helpers for now).

- [ ] **Step 10: Full suite + commit**

Run: `pnpm --filter @bill-alarm/server test` — expected ALL PASS (53 + 4 new = 57).

```bash
git add apps/server/src/services apps/server/src/routes/email.ts apps/server/src/routes/system.ts
git commit -m "feat(server): per-user mailbox, scan stack threading, per-user cron and SSE filtering"
```

---

### Task 3: Authorization inversion + tenant scoping for banks, accounts, rules, scan logs

**Files:**
- Modify: `apps/server/src/routes/auth.ts` (MEMBER_ALLOW → ADMIN_ONLY)
- Modify: `apps/server/src/routes/banks.ts`
- Modify: `apps/server/src/routes/bank-accounts.ts`
- Modify: `apps/server/src/routes/settings.ts` (notification rules)
- Modify: `apps/server/src/routes/system.ts` (scan-logs scoping)
- Modify: `apps/server/src/routes/config.ts` (drop email/calendar blocks from /status)
- Delete+Create: `apps/server/src/routes/__tests__/role-guard.test.ts` → rewritten as admin-only surface tests
- Test: `apps/server/src/routes/__tests__/tenant-isolation.test.ts` (new)

**Interfaces:**
- Consumes: `getAuthUser`, Task 1 nullable `userId` columns.
- Produces: ADMIN_ONLY enforcement exactly per Global Constraints; every banks/accounts/rules/scan-logs handler self-scoped with 404-on-foreign; `GET /api/banks` returns the caller's own full rows (role-based secret stripping REMOVED — own data); `GET /api/config/status` loses `email` and `calendar` blocks.

- [ ] **Step 1: Write the failing tests**

Create `apps/server/src/routes/__tests__/tenant-isolation.test.ts`:

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

async function json(method: string, path: string, cookie: string, body?: unknown): Promise<Response> {
  return app.request(path, {
    method,
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

// Bootstrap: admin via /setup, member via users API, both logged in.
const setup = await app.request('/api/auth/setup', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'boss', password: 'admin-password' }),
})
const boss = cookieOf(setup)
await json('POST', '/api/users', boss, { username: 'kid', password: 'member-password' })
const kidLogin = await app.request('/api/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'kid', password: 'member-password' }),
})
const kid = cookieOf(kidLogin)

describe('tenant isolation — banks / accounts / rules / scan logs', () => {
  it('banks: same preset enable coexists per user; lists are disjoint; foreign bank ids 404', async () => {
    const b1 = await json('POST', '/api/banks/enable/esun', boss, {})
    expect(b1.status).toBe(201)
    const b2 = await json('POST', '/api/banks/enable/esun', kid, {})
    expect(b2.status).toBe(201) // would violate the old global code unique

    const bossList = await (await json('GET', '/api/banks', boss)).json()
    const kidList = await (await json('GET', '/api/banks', kid)).json()
    expect(bossList).toHaveLength(1)
    expect(kidList).toHaveLength(1)
    expect(bossList[0].id).not.toBe(kidList[0].id)
    // own rows carry own secrets (no stripping of your own data)
    expect('pdfPassword' in bossList[0]).toBe(true)

    const foreign = await json('PATCH', `/api/banks/${bossList[0].id}`, kid, { name: 'hax' })
    expect(foreign.status).toBe(404)
    expect((await json('POST', '/api/banks/disable/esun', kid)).status).toBe(200) // own copy
    const bossAfter = await (await json('GET', '/api/banks', boss)).json()
    expect(bossAfter[0].isActive).toBe(true) // kid's disable didn't touch boss's bank
  })

  it('bank accounts: scoped CRUD, foreign 404', async () => {
    const created = await json('POST', '/api/bank-accounts', boss, { name: '薪轉', bankName: '玉山' })
    expect(created.status).toBe(201)
    const acc = await created.json()
    expect((await (await json('GET', '/api/bank-accounts', kid)).json())).toHaveLength(0)
    expect((await json('PATCH', `/api/bank-accounts/${acc.id}`, kid, { name: 'x' })).status).toBe(404)
    expect((await json('DELETE', `/api/bank-accounts/${acc.id}`, kid)).status).toBe(404)
  })

  it('notification rules: scoped CRUD, foreign 404', async () => {
    const created = await json('POST', '/api/notification-rules', boss, {
      name: '提前三天', daysBefore: 3, timeOfDay: '09:00', channels: ['telegram'],
    })
    expect(created.status).toBe(201)
    const rule = await created.json()
    expect(await (await json('GET', '/api/notification-rules', kid)).json()).toHaveLength(0)
    expect((await json('PATCH', `/api/notification-rules/${rule.id}`, kid, { name: 'x' })).status).toBe(404)
    expect((await json('DELETE', `/api/notification-rules/${rule.id}`, kid)).status).toBe(404)
  })

  it('scan logs: each user sees only their own', async () => {
    const bossUser = await prisma.user.findUnique({ where: { username: 'boss' } })
    await prisma.scanLog.create({ data: { trigger: 'manual', userId: bossUser!.id } })
    const kidLogs = await (await json('GET', '/api/scan-logs', kid)).json()
    expect(kidLogs.logs).toHaveLength(0)
    const bossLogs = await (await json('GET', '/api/scan-logs', boss)).json()
    expect(bossLogs.logs).toHaveLength(1)
  })
})
```

Rewrite `apps/server/src/routes/__tests__/role-guard.test.ts` (REPLACE the whole file):

```ts
import { describe, it, expect } from 'vitest'
import { setupTestDb } from '../../services/__tests__/helpers/test-db.js'

setupTestDb()
process.env.LOG_LEVEL = 'silent'

const { default: app } = await import('@/index.js')

function cookieOf(res: Response): string {
  return res.headers.get('set-cookie')?.split(';')[0] ?? ''
}

const setup = await app.request('/api/auth/setup', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'boss', password: 'admin-password' }),
})
const boss = cookieOf(setup)
await app.request('/api/users', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Cookie: boss },
  body: JSON.stringify({ username: 'kid', password: 'member-password' }),
})
const kidLogin = await app.request('/api/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'kid', password: 'member-password' }),
})
const kid = cookieOf(kidLogin)

describe('admin-only surface', () => {
  const cases: Array<[string, string]> = [
    ['GET', '/api/users'],
    ['POST', '/api/users'],
    ['POST', '/api/config/llm'],
    ['POST', '/api/config/gemini'],
    ['POST', '/api/config/openai'],
    ['POST', '/api/config/telegram'],
    ['POST', '/api/config/scan'],
    ['GET', '/api/config/status'],
    ['POST', '/api/llm/test'],
  ]

  it('member gets 403 on every admin-only route', async () => {
    for (const [method, path] of cases) {
      const res = await app.request(path, {
        method,
        headers: { 'Content-Type': 'application/json', Cookie: kid },
        body: method === 'GET' ? undefined : JSON.stringify({}),
      })
      expect(res.status, `${method} ${path}`).toBe(403)
    }
  })

  it('member is NOT blocked from tenant routes the old allow-list denied', async () => {
    for (const path of ['/api/notification-rules', '/api/bank-accounts', '/api/banks/presets']) {
      const res = await app.request(path, { headers: { Cookie: kid } })
      expect(res.status, path).toBe(200)
    }
  })

  it('admin passes the admin-only surface', async () => {
    const res = await app.request('/api/config/status', { headers: { Cookie: boss } })
    expect(res.status).toBe(200)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @bill-alarm/server test -- src/routes/__tests__/tenant-isolation.test.ts src/routes/__tests__/role-guard.test.ts`
Expected: FAIL (member 403 on tenant routes; global bank code unique semantics; no scoping).

- [ ] **Step 3: Invert the guard in `apps/server/src/routes/auth.ts`**

Replace the entire `MEMBER_ALLOW` array with:

```ts
// Global-infrastructure surface: only the admin may touch these. Every other
// authenticated route is available to all users and self-scopes its data.
const ADMIN_ONLY: Array<{ method: string; pattern: RegExp }> = [
  { method: '*', pattern: /^\/api\/users(\/|$)/ },
  { method: 'POST', pattern: /^\/api\/config\/(llm|gemini|openai|telegram|scan)$/ },
  { method: 'GET', pattern: /^\/api\/config\/status$/ },
  { method: 'POST', pattern: /^\/api\/llm\/test$/ },
]
```

and in `authGuard` replace the member allow-list block with:

```ts
      if (session.user.role !== 'admin') {
        const method = c.req.method
        const denied = ADMIN_ONLY.some(r => (r.method === '*' || r.method === method) && r.pattern.test(path))
        if (denied) return c.json({ error: 'forbidden' }, 403)
      }
```

- [ ] **Step 4: Scope `apps/server/src/routes/banks.ts`** — full replacement of the handlers (presets route unchanged):

```ts
app.get('/', async (c) => {
  const banks = await prisma.bank.findMany({
    where: { userId: getAuthUser(c).id },
    include: { _count: { select: { bills: true } }, bankAccount: true },
    orderBy: { name: 'asc' },
  })
  return c.json(banks)
})

app.post('/enable/:code', zValidator('json', z.object({
  pdfPassword: z.string().optional(),
}).optional()), async (c) => {
  const userId = getAuthUser(c).id
  const code = c.req.param('code')
  const preset = BANK_PRESETS.find((p) => p.code === code)
  if (!preset) return c.json({ error: 'Unknown bank code' }, 404)

  const existing = await prisma.bank.findFirst({ where: { userId, code } })
  if (existing) {
    const updated = await prisma.bank.update({
      where: { id: existing.id },
      data: { isActive: true },
    })
    return c.json(updated)
  }

  const body = c.req.valid('json')
  const bank = await prisma.bank.create({
    data: {
      code,
      name: preset.name,
      emailSenderPattern: preset.emailSender,
      emailSubjectPattern: preset.emailSubject,
      pdfPassword: body?.pdfPassword,
      isBuiltin: true,
      isActive: true,
      userId,
    },
  })
  return c.json(bank, 201)
})

app.post('/disable/:code', async (c) => {
  const bank = await prisma.bank.findFirst({ where: { userId: getAuthUser(c).id, code: c.req.param('code') } })
  if (!bank) return c.json({ error: 'Not found' }, 404)
  const updated = await prisma.bank.update({
    where: { id: bank.id },
    data: { isActive: false },
  })
  return c.json(updated)
})

app.patch('/:id', zValidator('json', z.object({
  name: z.string().min(1).optional(),
  emailSenderPattern: z.string().min(1).optional(),
  emailSubjectPattern: z.string().min(1).optional(),
  pdfPassword: z.string().nullable().optional(),
  parserConfig: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
  autoDebit: z.boolean().optional(),
  bankAccountId: z.string().nullable().optional(),
})), async (c) => {
  const userId = getAuthUser(c).id
  const existing = await prisma.bank.findFirst({ where: { id: c.req.param('id'), userId } })
  if (!existing) return c.json({ error: 'Not found' }, 404)
  const data = c.req.valid('json')
  if (data.bankAccountId) {
    const account = await prisma.bankAccount.findFirst({ where: { id: data.bankAccountId, userId } })
    if (!account) return c.json({ error: '找不到帳戶' }, 404)
  }
  const bank = await prisma.bank.update({ where: { id: existing.id }, data })
  return c.json(bank)
})

app.post('/', zValidator('json', z.object({
  name: z.string().min(1),
  emailSenderPattern: z.string().min(1),
  emailSubjectPattern: z.string().min(1),
  pdfPassword: z.string().optional(),
})), async (c) => {
  const data = c.req.valid('json')
  const bank = await prisma.bank.create({
    data: { ...data, isBuiltin: false, isActive: true, userId: getAuthUser(c).id },
  })
  return c.json(bank, 201)
})

app.delete('/:id', async (c) => {
  const bank = await prisma.bank.findFirst({ where: { id: c.req.param('id'), userId: getAuthUser(c).id } })
  if (!bank) return c.json({ error: 'Not found' }, 404)
  if (bank.isBuiltin) return c.json({ error: '無法刪除內建銀行，請改為停用' }, 400)
  await prisma.bank.delete({ where: { id: bank.id } })
  return c.json({ success: true })
})
```

- [ ] **Step 5: Scope `apps/server/src/routes/bank-accounts.ts`** — add `import { getAuthUser } from './auth.js'`; each handler:

```ts
app.get('/', async (c) => {
  const accounts = await prisma.bankAccount.findMany({
    where: { userId: getAuthUser(c).id },
    orderBy: { name: 'asc' },
  })
  return c.json(accounts)
})

app.post('/', zValidator('json', z.object({
  name: z.string().min(1),
  bankName: z.string().min(1),
  note: z.string().optional(),
})), async (c) => {
  const data = c.req.valid('json')
  const account = await prisma.bankAccount.create({ data: { ...data, userId: getAuthUser(c).id } })
  return c.json(account, 201)
})

app.patch('/:id', zValidator('json', z.object({
  name: z.string().min(1).optional(),
  bankName: z.string().min(1).optional(),
  note: z.string().nullable().optional(),
})), async (c) => {
  const existing = await prisma.bankAccount.findFirst({ where: { id: c.req.param('id'), userId: getAuthUser(c).id } })
  if (!existing) return c.json({ error: 'Not found' }, 404)
  const account = await prisma.bankAccount.update({ where: { id: existing.id }, data: c.req.valid('json') })
  return c.json(account)
})

app.delete('/:id', async (c) => {
  const existing = await prisma.bankAccount.findFirst({ where: { id: c.req.param('id'), userId: getAuthUser(c).id } })
  if (!existing) return c.json({ error: 'Not found' }, 404)
  const usedBy = await prisma.bank.count({ where: { bankAccountId: existing.id } })
  if (usedBy > 0) {
    return c.json({ error: '此帳戶仍被銀行使用中，請先解除關聯' }, 400)
  }
  await prisma.bankAccount.delete({ where: { id: existing.id } })
  return c.json({ success: true })
})
```

- [ ] **Step 6: Scope `apps/server/src/routes/settings.ts` (rules)** — add `import { getAuthUser } from './auth.js'`:

```ts
app.get('/', async (c) => {
  const rules = await prisma.notificationRule.findMany({
    where: { userId: getAuthUser(c).id },
    orderBy: { daysBefore: 'desc' },
  })
  return c.json(rules.map((r) => ({ ...r, channels: JSON.parse(r.channels) })))
})

app.post('/', zValidator('json', ruleSchema), async (c) => {
  const data = c.req.valid('json')
  const rule = await prisma.notificationRule.create({
    data: { ...data, channels: JSON.stringify(data.channels), userId: getAuthUser(c).id },
  })
  return c.json({ ...rule, channels: data.channels }, 201)
})

app.patch('/:id', zValidator('json', updateRuleSchema), async (c) => {
  const existing = await prisma.notificationRule.findFirst({ where: { id: c.req.param('id'), userId: getAuthUser(c).id } })
  if (!existing) return c.json({ error: 'Not found' }, 404)
  const data = c.req.valid('json')
  const updateData: Record<string, unknown> = { ...data }
  if (data.channels) updateData.channels = JSON.stringify(data.channels)
  const rule = await prisma.notificationRule.update({ where: { id: existing.id }, data: updateData })
  return c.json({ ...rule, channels: JSON.parse(rule.channels) })
})

app.delete('/:id', async (c) => {
  const existing = await prisma.notificationRule.findFirst({ where: { id: c.req.param('id'), userId: getAuthUser(c).id } })
  if (!existing) return c.json({ error: 'Not found' }, 404)
  await prisma.notificationRule.delete({ where: { id: existing.id } })
  return c.json({ success: true })
})
```

- [ ] **Step 7: Scope scan logs in `apps/server/src/routes/system.ts`** — in `GET /scan-logs`:

```ts
  const logs = await prisma.scanLog.findMany({
    where: { userId: getAuthUser(c).id },
    orderBy: { startedAt: 'desc' },
    take: limit,
  })
```

- [ ] **Step 8: Trim `apps/server/src/routes/config.ts` `/status`** — remove the email block (the `verifyConnection` import, `hasEmail`/`conn` computation, `email:` response block, and the `imapHost/imapPort/imapUser/imapPassword` reads) and the calendar block (`getOrCreateIcsFeedToken` import+call, `feedPath`, `calendar:` response block). The response keeps `telegram`, `scan`, `gemini`, `openai`, `llm`.

- [ ] **Step 9: Full suite + commit**

Run: `pnpm --filter @bill-alarm/server test` — ALL PASS.

```bash
git add apps/server/src/routes
git commit -m "feat(server): admin-only inversion, tenant scoping for banks/accounts/rules/scan-logs"
```

---

### Task 4: Bills tenant scoping

**Files:**
- Modify: `apps/server/src/routes/bills.ts`
- Modify: `apps/server/src/routes/system.ts` (`/parser/bootstrap/:billId`)
- Test: extend `apps/server/src/routes/__tests__/tenant-isolation.test.ts`

**Interfaces:**
- Consumes: `getAuthUser`; bills own via `bank.userId`.
- Produces: all bill reads/writes self-scoped; foreign bill ids → 404 on every endpoint (detail/pdf/pay/unpay/patch/reparse/delete/bootstrap); list/summary filtered by `bank: { userId }`.

- [ ] **Step 1: Write the failing tests** — append to `tenant-isolation.test.ts`:

```ts
describe('tenant isolation — bills', () => {
  let bossBillId = ''

  it('setup: a bill under boss's bank', async () => {
    const bossUser = await prisma.user.findUnique({ where: { username: 'boss' } })
    const bank = await prisma.bank.create({
      data: { name: 'B-Bank', emailSenderPattern: 'b@b', emailSubjectPattern: 'bill', userId: bossUser!.id },
    })
    const bill = await prisma.bill.create({
      data: { bankId: bank.id, billingPeriod: '2026-07', amount: 1234, dueDate: new Date() },
    })
    bossBillId = bill.id
    expect(bossBillId).toBeTruthy()
  })

  it('lists and summary are per-user', async () => {
    const bossList = await (await json('GET', '/api/bills', boss)).json()
    expect(bossList.data.some((b: any) => b.id === bossBillId)).toBe(true)
    const kidList = await (await json('GET', '/api/bills', kid)).json()
    expect(kidList.data).toHaveLength(0)
    const kidSummary = await (await json('GET', '/api/bills/summary', kid)).json()
    expect(kidSummary.pendingCount).toBe(0)
  })

  it('every single-bill endpoint 404s for a foreign bill', async () => {
    const cases: Array<[string, string, unknown?]> = [
      ['GET', `/api/bills/${bossBillId}`],
      ['GET', `/api/bills/${bossBillId}/pdf`],
      ['PATCH', `/api/bills/${bossBillId}`, { amount: 1 }],
      ['PATCH', `/api/bills/${bossBillId}/pay`, {}],
      ['POST', `/api/bills/${bossBillId}/unpay`],
      ['POST', `/api/bills/${bossBillId}/reparse`],
      ['DELETE', `/api/bills/${bossBillId}`],
      ['GET', `/api/parser/bootstrap/${bossBillId}`],
    ]
    for (const [method, path, body] of cases) {
      const res = await json(method, path, kid, body)
      expect(res.status, `${method} ${path}`).toBe(404)
    }
    // owner still passes
    expect((await json('GET', `/api/bills/${bossBillId}`, boss)).status).toBe(200)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @bill-alarm/server test -- src/routes/__tests__/tenant-isolation.test.ts`
Expected: FAIL (kid sees boss's bill; foreign access 200).

- [ ] **Step 3: Implement scoping in `apps/server/src/routes/bills.ts`**

Add `import { getAuthUser } from './auth.js'` and a shared ownership helper right after `const app = new Hono()`:

```ts
/** Load a bill only if it belongs to the caller (via bank ownership). */
async function ownBill(c: Parameters<typeof getAuthUser>[0], id: string) {
  return prisma.bill.findFirst({ where: { id, bank: { userId: getAuthUser(c).id } } })
}
```

`GET /summary` — scope every query:

```ts
  const userId = getAuthUser(c).id
  const [pending, paid, overdue] = await Promise.all([
    prisma.bill.findMany({ where: { status: BillStatus.PENDING, bank: { userId } } }),
    prisma.bill.count({ where: { status: BillStatus.PAID, billingPeriod: currentMonth, bank: { userId } } }),
    prisma.bill.count({ where: { status: BillStatus.OVERDUE, bank: { userId } } }),
  ])
```

and the month query:

```ts
    const monthBills = await prisma.bill.findMany({
      where: { billingPeriod: month, bank: { userId } },
      include: { bank: { select: { id: true, name: true, autoDebit: true } } },
      orderBy: { dueDate: 'asc' },
    })
```

`GET /` — the where object starts scoped:

```ts
  const where: Record<string, unknown> = { bank: { userId: getAuthUser(c).id } }
```

`GET /:id`:

```ts
app.get('/:id', async (c) => {
  const own = await ownBill(c, c.req.param('id'))
  if (!own) return c.json({ error: 'Bill not found' }, 404)
  const bill = await prisma.bill.findUnique({
    where: { id: own.id },
    include: {
      bank: { select: { id: true, name: true, code: true, autoDebit: true, isActive: true } },
      notifications: { orderBy: { sentAt: 'desc' } },
    },
  })
  return c.json(bill)
})
```

`PATCH /:id`, `PATCH /:id/pay`, `POST /:id/unpay`, `DELETE /:id` — each begins with:

```ts
  const own = await ownBill(c, c.req.param('id'))
  if (!own) return c.json({ error: 'Bill not found' }, 404)
```

then operates on `own.id` (`prisma.bill.update({ where: { id: own.id }, ... })` etc.; unpay drops its previous `findUnique` in favor of this guard; delete keeps its notificationLog deleteMany first).

`POST /:id/reparse` — replace the initial `findUnique` with:

```ts
  const guard = await ownBill(c, c.req.param('id'))
  if (!guard) return c.json({ error: 'Bill not found' }, 404)
  const bill = await prisma.bill.findUnique({
    where: { id: guard.id },
    include: { bank: true },
  })
  if (!bill) return c.json({ error: 'Bill not found' }, 404)
```

`GET /:id/pdf` — replace the lookup with:

```ts
  const own = await ownBill(c, c.req.param('id'))
  if (!own) return c.json({ error: 'PDF not found' }, 404)
  const bill = await prisma.bill.findUnique({
    where: { id: own.id },
    include: { bank: { select: { pdfPassword: true } } },
  })
  if (!bill?.pdfPath) return c.json({ error: 'PDF not found' }, 404)
```

`apps/server/src/routes/system.ts` `GET /parser/bootstrap/:billId` — replace the lookup with:

```ts
  const bill = await prisma.bill.findFirst({
    where: { id: c.req.param('billId'), bank: { userId: getAuthUser(c).id } },
    include: { bank: true },
  })
  if (!bill) return c.json({ error: 'Bill not found' }, 404)
```

- [ ] **Step 4: Full suite + commit**

Run: `pnpm --filter @bill-alarm/server test` — ALL PASS.

```bash
git add apps/server/src/routes/bills.ts apps/server/src/routes/system.ts apps/server/src/routes/__tests__/tenant-isolation.test.ts
git commit -m "feat(server): bill routes scoped to owning user"
```

---

### Task 5: Per-user calendar feed + owner-targeted notifications

**Files:**
- Modify: `apps/server/src/routes/calendar-feed.ts`
- Modify: `apps/server/src/services/telegram.ts` (`sendToUser`, remove `broadcast`)
- Modify: `apps/server/src/services/notification.ts`
- Modify: `apps/server/src/services/settings.ts` (remove `ICS_FEED_TOKEN` key + both token helpers)
- Test: `apps/server/src/routes/__tests__/calendar-feed.test.ts` (new), rewrite broadcast tests in `apps/server/src/services/__tests__/telegram.test.ts`, extend `apps/server/src/services/__tests__/` with `notification-owner.test.ts` (new)

**Interfaces:**
- Consumes: `User.icsFeedToken`/`deletedAt` (Task 1), rules/bills scoping (Tasks 3–4).
- Produces:
  - `sendToUser(userId: string, text: string): Promise<{ ok: boolean; error?: string }>` (unbound → `{ ok: false, error: '使用者未綁定 Telegram' }`; never throws)
  - `sendNewBillAlert/sendBillReminder/sendOverdueWarning: (bill, bank) => Promise<{ ok: boolean; error?: string }>` — message text byte-identical, routed via `sendToUser(bank.userId!, …)`
  - `GET /api/calendar/feed/:token.ics` → active user's bills only; `GET /api/calendar/info` + `POST /api/calendar/rotate` operate on the caller's own token

- [ ] **Step 1: Write the failing tests**

Create `apps/server/src/routes/__tests__/calendar-feed.test.ts`:

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
      data: { bankId: bossBank.id, billingPeriod: '2026-07', amount: 500, dueDate: new Date(Date.now() + 86400000) },
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

  it('deactivated user's token is dead', async () => {
    const info = await (await app.request('/api/calendar/info', { headers: { Cookie: kid } })).json()
    await prisma.user.update({ where: { id: kidRow.id }, data: { deletedAt: new Date() } })
    expect((await app.request(`/api/calendar/feed/${info.token}.ics`)).status).toBe(404)
  })
})
```

Create `apps/server/src/services/__tests__/notification-owner.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setupTestDb } from './helpers/test-db.js'

setupTestDb()
process.env.LOG_LEVEL = 'silent'

const { default: prisma } = await import('@/prisma.js')
const { setSetting, KEYS } = await import('../settings.js')
const telegram = await import('../telegram.js')
const { processReminderRules } = await import('../notification.js')

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

function okResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 })
}

beforeEach(async () => {
  fetchMock.mockReset()
  await prisma.notificationLog.deleteMany()
  await prisma.bill.deleteMany()
  await prisma.notificationRule.deleteMany()
  await prisma.bank.deleteMany()
  await prisma.user.deleteMany()
  await prisma.setting.deleteMany()
})

async function seedUserWithDueBill(username: string, chatId: string | null, deletedAt: Date | null = null) {
  const user = await prisma.user.create({
    data: { username, passwordHash: 'x:y', role: 'member', telegramChatId: chatId, deletedAt },
  })
  const bank = await prisma.bank.create({
    data: { name: `${username}-bank`, emailSenderPattern: 'x@x', emailSubjectPattern: 'b', userId: user.id },
  })
  const due = new Date()
  due.setHours(0, 0, 0, 0)
  due.setDate(due.getDate() + 3)
  const bill = await prisma.bill.create({
    data: { bankId: bank.id, billingPeriod: '2026-07', amount: 100, dueDate: due },
  })
  await prisma.notificationRule.create({
    data: { name: 'r', daysBefore: 3, timeOfDay: '09:00', channels: JSON.stringify(['telegram']), userId: user.id },
  })
  return { user, bank, bill }
}

describe('owner-targeted notifications', () => {
  it('sendToUser: unbound user fails gracefully with the zh-TW reason', async () => {
    await setSetting(KEYS.TELEGRAM_BOT_TOKEN, 'tok')
    const u = await prisma.user.create({ data: { username: 'nobind', passwordHash: 'x:y', role: 'member' } })
    const r = await telegram.sendToUser(u.id, 'hi')
    expect(r).toEqual({ ok: false, error: '使用者未綁定 Telegram' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reminders go only to each bill owner; deactivated owners are silent', async () => {
    await setSetting(KEYS.TELEGRAM_BOT_TOKEN, 'tok')
    await seedUserWithDueBill('alice', '111')
    await seedUserWithDueBill('bob', '222')
    await seedUserWithDueBill('gone', '333', new Date())
    fetchMock.mockResolvedValue(okResponse({ ok: true }))

    await processReminderRules()

    const sentChatIds = fetchMock.mock.calls.map(call => JSON.parse(call[1].body).chat_id).sort()
    expect(sentChatIds).toEqual(['111', '222']) // no 333
    const logs = await prisma.notificationLog.findMany()
    expect(logs).toHaveLength(2) // deactivated: no log row either
    expect(logs.every(l => l.success)).toBe(true)
  })

  it('owner without binding gets a failed log row', async () => {
    await setSetting(KEYS.TELEGRAM_BOT_TOKEN, 'tok')
    await seedUserWithDueBill('carol', null)
    await processReminderRules()
    const logs = await prisma.notificationLog.findMany()
    expect(logs).toHaveLength(1)
    expect(logs[0].success).toBe(false)
    expect(logs[0].errorMessage).toContain('使用者未綁定 Telegram')
  })
})
```

In `apps/server/src/services/__tests__/telegram.test.ts`: DELETE the `describe('broadcast', ...)` block entirely (broadcast is removed); keep `getBotUsername` tests; add:

```ts
describe('sendToUser', () => {
  it('sends to the user's own chat id', async () => {
    await setSetting(KEYS.TELEGRAM_BOT_TOKEN, 'tok')
    const u = await prisma.user.create({
      data: { username: 'bound', passwordHash: 'x:y', role: 'member', telegramChatId: '777' },
    })
    fetchMock.mockResolvedValue(okResponse({ ok: true }))
    const r = await telegram.sendToUser(u.id, 'hello')
    expect(r.ok).toBe(true)
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).chat_id).toBe('777')
  })
})
```

(Quote note: write test names with double quotes in the actual files to avoid apostrophe clashes.)

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @bill-alarm/server test -- src/routes/__tests__/calendar-feed.test.ts src/services/__tests__/notification-owner.test.ts src/services/__tests__/telegram.test.ts`
Expected: FAIL (missing sendToUser; global feed token; reminder loop broadcasts).

- [ ] **Step 3: `apps/server/src/services/telegram.ts`** — delete `broadcast` and `BroadcastResult`; add:

```ts
export interface SendOutcome {
  ok: boolean
  error?: string
}

/** Send to one user's bound chat. Unbound users fail gracefully — callers log, never throw. */
export async function sendToUser(userId: string, text: string): Promise<SendOutcome> {
  const token = await getBotToken()
  if (!token) {
    console.warn('[telegram] Bot token not configured, skipping message')
    return { ok: false, error: 'bot token not configured' }
  }
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { telegramChatId: true } })
  if (!user?.telegramChatId) {
    return { ok: false, error: '使用者未綁定 Telegram' }
  }
  return sendRaw(token, user.telegramChatId, text)
}
```

The three senders keep their bodies byte-identical up to the final call, which becomes (each):

```ts
  return sendToUser(bank.userId!, lines.join('\n'))   // sendNewBillAlert
  return sendToUser(bank.userId!, text)               // sendBillReminder / sendOverdueWarning
```

with return type `Promise<SendOutcome>`. (`bank.userId!` — nullable only until Task 7; rows always carry it.)

- [ ] **Step 4: `apps/server/src/services/notification.ts`**

`processNewBill` telegram block:

```ts
  const r = await sendNewBillAlert(bill, bank)
  await logNotification(bill.id, null, 'telegram', '新帳單通知', r.ok, r.error)
  logger.info({ bank: bank.name, ok: r.ok }, 'Telegram notification sent')
```

`processReminderRules` — per-user rules, per-owner bills, deactivated silence:

```ts
export async function processReminderRules(): Promise<void> {
  const rules = await prisma.notificationRule.findMany({
    where: { isActive: true, user: { deletedAt: null } },
  })
  logger.info({ ruleCount: rules.length }, 'Processing reminder rules')
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  for (const rule of rules) {
    const targetDate = new Date(today)
    targetDate.setDate(targetDate.getDate() + rule.daysBefore)

    const bills = await prisma.bill.findMany({
      where: {
        status: BillStatus.PENDING,
        bank: { userId: rule.userId },
        dueDate: {
          gte: targetDate,
          lt: new Date(targetDate.getTime() + 24 * 60 * 60 * 1000),
        },
      },
      include: { bank: true },
    })

    const channels: string[] = JSON.parse(rule.channels)

    for (const bill of bills) {
      if (bill.bank.autoDebit) continue

      const todayStart = new Date(today)
      const todayEnd = new Date(today)
      todayEnd.setDate(todayEnd.getDate() + 1)

      const alreadySent = await prisma.notificationLog.findFirst({
        where: {
          billId: bill.id,
          ruleId: rule.id,
          sentAt: { gte: todayStart, lt: todayEnd },
          success: true,
        },
      })
      if (alreadySent) continue

      for (const channel of channels) {
        try {
          if (channel === 'telegram') {
            const r = await sendBillReminder(bill, bill.bank)
            await logNotification(bill.id, rule.id, channel, rule.name, r.ok, r.error)
          }
        } catch (e) {
          await logNotification(bill.id, rule.id, channel, rule.name, false, (e as Error).message)
        }
      }
    }
  }
}
```

`processOverdueBills` — status flip for everyone, notifications only for active owners:

```ts
  const overdueBills = await prisma.bill.findMany({
    where: {
      status: BillStatus.PENDING,
      dueDate: { lt: today },
    },
    include: { bank: { include: { user: { select: { deletedAt: true } } } } },
  })
  ...
  for (const bill of overdueBills) {
    await prisma.bill.update({
      where: { id: bill.id },
      data: { status: BillStatus.OVERDUE },
    })
    logger.warn({ bank: bill.bank.name, amount: bill.amount, dueDate: bill.dueDate }, 'Bill marked overdue')

    if (bill.bank.user?.deletedAt) continue // deactivated owner: status is fact, noise is not
    const r = await sendOverdueWarning(bill, bill.bank)
    await logNotification(bill.id, null, 'telegram', '逾期警告', r.ok, r.error)
  }
```

- [ ] **Step 5: `apps/server/src/routes/calendar-feed.ts`** — full rewrite of the route logic:

```ts
import { Hono } from 'hono'
import { createEvents, type EventAttributes, type DateArray } from 'ics'
import prisma from '@/prisma.js'
import { getSetting, KEYS } from '@/services/settings.js'
import { BillStatus } from '@bill-alarm/shared/types'
import { getAuthUser } from './auth.js'

const app = new Hono()

function formatAmount(amount: number): string {
  return `NT$ ${amount.toLocaleString('zh-TW')}`
}

function dateToArray(d: Date): DateArray {
  return [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()]
}

function newFeedToken(): string {
  return crypto.randomUUID().replace(/-/g, '')
}

async function feedResponse(c: Parameters<typeof getAuthUser>[0], token: string) {
  const baseUrl = (await getSetting(KEYS.APP_BASE_URL)) || ''
  const path = `/api/calendar/feed/${token}.ics`
  return c.json({ token, feedUrl: baseUrl ? `${baseUrl}${path}` : path, feedPath: path })
}

// GET /feed/:token.ics — public; the personal token gates access
app.get('/feed/:token{[^/]+\\.ics}', async (c) => {
  const token = c.req.param('token').replace(/\.ics$/, '')
  const owner = await prisma.user.findFirst({ where: { icsFeedToken: token, deletedAt: null } })
  if (!owner) return c.text('Not Found', 404)

  const bills = await prisma.bill.findMany({
    where: {
      status: { in: [BillStatus.PENDING, BillStatus.OVERDUE] },
      bank: { userId: owner.id },
    },
    include: { bank: true },
    orderBy: { dueDate: 'asc' },
  })
  // ...events mapping, createEvents, and response EXACTLY as the current file...
})

app.get('/info', async (c) => {
  const me = await prisma.user.findUnique({ where: { id: getAuthUser(c).id } })
  if (!me) return c.json({ error: 'unauthorized' }, 401)
  let token = me.icsFeedToken
  if (!token) {
    token = newFeedToken()
    await prisma.user.update({ where: { id: me.id }, data: { icsFeedToken: token } })
  }
  return feedResponse(c, token)
})

app.post('/rotate', async (c) => {
  const token = newFeedToken()
  await prisma.user.update({ where: { id: getAuthUser(c).id }, data: { icsFeedToken: token } })
  return feedResponse(c, token)
})

export default app
```

(The `events` mapping block is copied verbatim from the current file.)

- [ ] **Step 6: settings.ts final cleanup** — delete `ICS_FEED_TOKEN` from `KEYS` and delete `getOrCreateIcsFeedToken` + `rotateIcsFeedToken` (config.ts stopped using them in Task 3; calendar-feed.ts stopped in this task — verify with grep that no importer remains).

- [ ] **Step 7: Full suite + commit**

Run: `pnpm --filter @bill-alarm/server test` — ALL PASS.

```bash
git add apps/server/src/routes/calendar-feed.ts apps/server/src/services apps/server/src/routes/__tests__/calendar-feed.test.ts
git commit -m "feat(server): per-user calendar feeds, owner-targeted notifications"
```

---

### Task 6: User lifecycle — deactivate / restore / permanent delete

**Files:**
- Modify: `apps/server/src/routes/users.ts`
- Test: `apps/server/src/routes/__tests__/users.test.ts` (extend)

**Interfaces:**
- Consumes: `destroyUserSessions`, deactivation guards (Task 1).
- Produces (web relies on):
  - `GET /api/users` DTO: `{ id, username, role, telegramBound, emailConfigured, deletedAt, createdAt }` (includes deactivated users)
  - `DELETE /api/users/:id` → deactivate (`{ ok: true }`; admin target 400)
  - `POST /api/users/:id/restore` → `{ ok: true }` (404 unknown)
  - `DELETE /api/users/:id/permanent` → `{ ok: true }`; 400 `{ error: '請先停用帳號' }` if not deactivated; 400 for admin; deletes rules/scan-logs/notification-logs/bills/banks/bank-accounts/user in one transaction

- [ ] **Step 1: Write the failing tests** — in `users.test.ts`, replace the old `'cannot delete the admin; deleting a member cascades sessions'` test with:

```ts
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
      data: { bankId: bank.id, billingPeriod: '2026-07', amount: 42, dueDate: new Date() },
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
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @bill-alarm/server test -- src/routes/__tests__/users.test.ts`
Expected: FAIL (restore/permanent 404; DTO lacks deletedAt; old delete removed the row).

- [ ] **Step 3: Implement `apps/server/src/routes/users.ts`**

`toDTO` becomes:

```ts
function toDTO(u: { id: string; username: string; role: string; telegramChatId: string | null; imapUser: string | null; imapPassword: string | null; deletedAt: Date | null; createdAt: Date }) {
  return {
    id: u.id,
    username: u.username,
    role: u.role,
    telegramBound: !!u.telegramChatId,
    emailConfigured: !!(u.imapUser && u.imapPassword),
    deletedAt: u.deletedAt,
    createdAt: u.createdAt,
  }
}
```

Replace `app.delete('/:id', ...)` and add the two new routes:

```ts
// Deactivate (soft delete): data preserved, login/session/cron/notifications disabled
app.delete('/:id', async (c) => {
  const user = await prisma.user.findUnique({ where: { id: c.req.param('id') } })
  if (!user) return c.json({ error: '找不到使用者' }, 404)
  if (user.role === 'admin') return c.json({ error: '無法停用管理員帳號' }, 400)
  await prisma.user.update({ where: { id: user.id }, data: { deletedAt: new Date() } })
  await destroyUserSessions(user.id)
  return c.json({ ok: true })
})

app.post('/:id/restore', async (c) => {
  const user = await prisma.user.findUnique({ where: { id: c.req.param('id') } })
  if (!user) return c.json({ error: '找不到使用者' }, 404)
  await prisma.user.update({ where: { id: user.id }, data: { deletedAt: null } })
  return c.json({ ok: true })
})

// Permanent delete: only from the deactivated state, wipes all tenant data
app.delete('/:id/permanent', async (c) => {
  const user = await prisma.user.findUnique({ where: { id: c.req.param('id') } })
  if (!user) return c.json({ error: '找不到使用者' }, 404)
  if (user.role === 'admin') return c.json({ error: '無法刪除管理員帳號' }, 400)
  if (!user.deletedAt) return c.json({ error: '請先停用帳號' }, 400)
  await prisma.$transaction([
    prisma.notificationLog.deleteMany({ where: { bill: { bank: { userId: user.id } } } }),
    prisma.bill.deleteMany({ where: { bank: { userId: user.id } } }),
    prisma.bank.deleteMany({ where: { userId: user.id } }),
    prisma.bankAccount.deleteMany({ where: { userId: user.id } }),
    prisma.notificationRule.deleteMany({ where: { userId: user.id } }),
    prisma.scanLog.deleteMany({ where: { userId: user.id } }),
    prisma.user.delete({ where: { id: user.id } }), // sessions cascade
  ])
  return c.json({ ok: true })
})
```

Routing note: register `/:id/permanent` BEFORE `/:id` if Hono matching order requires it (it does not for distinct methods+paths here, but keep `delete /:id/permanent` above `delete /:id` for clarity).

- [ ] **Step 4: Full suite + commit**

Run: `pnpm --filter @bill-alarm/server test` — ALL PASS.

```bash
git add apps/server/src/routes/users.ts apps/server/src/routes/__tests__/users.test.ts
git commit -m "feat(server): user lifecycle — deactivate, restore, permanent delete"
```

---

### Task 7: Contract migration — userId NOT NULL

**Files:**
- Modify: `apps/server/prisma/schema.prisma` (four `userId String?` → `String`, relations required)
- Create: `apps/server/prisma/migrations/<timestamp>_tenancy_contract/migration.sql`
- Modify: `apps/server/src/services/telegram.ts` (drop the `!` on `bank.userId!` — now typed non-null)

- [ ] **Step 1: Flip the schema** — in all four models change `userId String?` → `userId String` and `user User? @relation(...)` → `user User @relation(...)`.

- [ ] **Step 2: Create the migration**

```bash
cd apps/server
pnpm exec prisma migrate dev --name tenancy_contract --create-only
```

The generated SQL rebuilds the four tables with `userId TEXT NOT NULL`. Keep it, but add this defensive backfill AT THE TOP of the file (protects any row created by hand between migrations):

```sql
UPDATE "banks" SET "userId" = (SELECT "id" FROM "users" WHERE "role" = 'admin' LIMIT 1) WHERE "userId" IS NULL;
UPDATE "bank_accounts" SET "userId" = (SELECT "id" FROM "users" WHERE "role" = 'admin' LIMIT 1) WHERE "userId" IS NULL;
UPDATE "notification_rules" SET "userId" = (SELECT "id" FROM "users" WHERE "role" = 'admin' LIMIT 1) WHERE "userId" IS NULL;
UPDATE "scan_logs" SET "userId" = (SELECT "id" FROM "users" WHERE "role" = 'admin' LIMIT 1) WHERE "userId" IS NULL;
```

Apply + regenerate:

```bash
pnpm exec prisma migrate dev
pnpm exec prisma generate
```

- [ ] **Step 3: Remove the interim non-null assertions** — in `apps/server/src/services/telegram.ts`, `bank.userId!` → `bank.userId` (three senders).

- [ ] **Step 4: Sweep tests that create tenant rows without a user**

```bash
grep -rn "prisma\.\(bank\|bankAccount\|notificationRule\|scanLog\)\.create" apps/server/src --include="*.test.ts"
```

Any create call whose `data` lacks `userId` (likely `email-parser-dedup.test.ts`) now violates NOT NULL: give each such test a helper user (`prisma.user.create({ data: { username: '<unique>', passwordHash: 'x:y', role: 'member' } })`) and pass its id as `userId`. Do not change what the tests assert.

- [ ] **Step 5: Full suite + commit**

Run: `pnpm --filter @bill-alarm/server test` — ALL PASS.

```bash
git add apps/server/prisma apps/server/src/services/telegram.ts
git commit -m "feat(server): contract migration — tenant userId required"
```

---

### Task 8: Web — composables, types, gating reverts, users lifecycle UI

**Files:**
- Modify: `apps/web/composables/useSettingsApi.ts`
- Modify: `apps/web/composables/useUsersApi.ts`
- Modify: `apps/web/composables/useNavItems.ts`
- Modify: `apps/web/types/settings.ts`
- Modify: `apps/web/pages/bills/[id].vue`
- Modify: `apps/web/components/settings/UsersCard.vue`

**Interfaces:**
- Consumes: Task 2 email status shape, Task 6 users DTO/lifecycle endpoints, Task 3 config/status slim shape.
- Produces: `useUsersApi` gains `restore(id)` / `removePermanently(id)`; `UserDTO` gains `emailConfigured: boolean; deletedAt: string | null`; nav unfiltered; bill actions ungated.

- [ ] **Step 1: `apps/web/composables/useNavItems.ts`** — remove the role filter (everyone sees all five tabs):

```ts
export function useNavItems(): ComputedRef<NavItem[]> {
  return computed(() => ALL_ITEMS)
}
```

(Keep the `ComputedRef` return type so `app.vue`/`BottomNav.vue` consumers stay untouched; delete the now-unused `useMe` call and the members comment.)

- [ ] **Step 2: `apps/web/pages/bills/[id].vue`** — remove the `isAdmin` gating added by the previous cycle: `v-if="!editing && isAdmin"` → `v-if="!editing"` (編輯 and Trash2), `v-if="bill.pdfPath && isAdmin"` → `v-if="bill.pdfPath"`; delete the `const { isAdmin } = useAuth()` line.

- [ ] **Step 3: `apps/web/types/settings.ts`** — `ConfigStatus` drops `email` and `calendar` blocks (keep `telegram/scan/gemini/openai/llm`). Add:

```ts
export interface EmailStatus {
  hasCredentials: boolean
  connected: boolean
  message: string
  email?: string
  host: string
  port: number
  user: string | null
}
```

- [ ] **Step 4: `apps/web/composables/useSettingsApi.ts`**

- `getConfigStatus` type: remove the `email` and `calendar` fields to match.
- `getEmailStatus: () => get<EmailStatus>('/email/status')` (import the type via `~/types/settings`).

- [ ] **Step 5: `apps/web/composables/useUsersApi.ts`**

```ts
export interface UserDTO {
  id: string
  username: string
  role: 'admin' | 'member'
  telegramBound: boolean
  emailConfigured: boolean
  deletedAt: string | null
  createdAt: string
}

export function useUsersApi() {
  const { get, post, del } = useApi()
  return {
    list: () => get<UserDTO[]>('/users'),
    create: (username: string, password: string) => post<UserDTO>('/users', { username, password }),
    resetPassword: (id: string, password: string) => post<{ ok: boolean }>(`/users/${id}/reset-password`, { password }),
    deactivate: (id: string) => del<{ ok: boolean }>(`/users/${id}`),
    restore: (id: string) => post<{ ok: boolean }>(`/users/${id}/restore`),
    removePermanently: (id: string) => del<{ ok: boolean }>(`/users/${id}/permanent`),
  }
}
```

- [ ] **Step 6: `apps/web/components/settings/UsersCard.vue`** — lifecycle UI:

Script changes: rename `deleteTarget` flow to two dialogs — `deactivateTarget` and `purgeTarget`:

```ts
const deactivateTarget = ref<UserDTO | null>(null)
const purgeTarget = ref<UserDTO | null>(null)

async function handleDeactivate() {
  if (!deactivateTarget.value) return
  submitting.value = true
  try {
    await usersApi.deactivate(deactivateTarget.value.id)
    toast.success(`已停用 ${deactivateTarget.value.username}`, { description: '資料保留，可隨時還原。' })
    deactivateTarget.value = null
    await fetchUsers()
  } catch (e: any) {
    toast.error('停用失敗', { description: e?.data?.error ?? String(e) })
  } finally {
    submitting.value = false
  }
}

async function handleRestore(user: UserDTO) {
  submitting.value = true
  try {
    await usersApi.restore(user.id)
    toast.success(`已還原 ${user.username}`)
    await fetchUsers()
  } catch (e: any) {
    toast.error('還原失敗', { description: e?.data?.error ?? String(e) })
  } finally {
    submitting.value = false
  }
}

async function handlePurge() {
  if (!purgeTarget.value) return
  submitting.value = true
  try {
    await usersApi.removePermanently(purgeTarget.value.id)
    toast.success(`已永久刪除 ${purgeTarget.value.username}`)
    purgeTarget.value = null
    await fetchUsers()
  } catch (e: any) {
    toast.error('刪除失敗', { description: e?.data?.error ?? String(e) })
  } finally {
    submitting.value = false
  }
}
```

Template — user row status/actions (replace the current badge/action area):

```vue
        <div class="flex min-w-0 items-center gap-2">
          <span class="truncate text-sm font-medium">{{ user.username }}</span>
          <Badge variant="secondary" class="text-[10px]">{{ user.role === 'admin' ? '管理者' : '成員' }}</Badge>
          <Badge v-if="user.deletedAt" variant="outline" class="text-[10px] text-muted-foreground">已停用</Badge>
          <span v-else class="text-xs text-muted-foreground">
            {{ user.emailConfigured ? '信箱已設定' : '信箱未設定' }} · {{ user.telegramBound ? 'TG 已綁定' : 'TG 未綁定' }}
          </span>
        </div>
        <div class="flex items-center gap-1">
          <template v-if="!user.deletedAt">
            <Button v-if="user.role !== 'admin'" size="icon-sm" variant="ghost" title="重設密碼" @click="resetTarget = user; resetPassword = ''">
              <KeyRound class="h-4 w-4" />
            </Button>
            <Button
              v-if="user.role !== 'admin'"
              size="icon-sm" variant="ghost" title="停用帳號"
              class="text-destructive hover:bg-destructive/10 hover:text-destructive"
              @click="deactivateTarget = user"
            >
              <UserX class="h-4 w-4" />
            </Button>
          </template>
          <template v-else>
            <Button size="sm" variant="outline" :disabled="submitting" @click="handleRestore(user)">還原</Button>
            <Button
              size="sm" variant="ghost"
              class="text-destructive hover:bg-destructive/10 hover:text-destructive"
              @click="purgeTarget = user"
            >
              永久刪除
            </Button>
          </template>
        </div>
```

Dialogs — replace the delete-confirm dialog with two:

```vue
    <!-- Deactivate confirm -->
    <Dialog :open="!!deactivateTarget" @update:open="(v: boolean) => { if (!v) deactivateTarget = null }">
      <DialogContent class="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>停用帳號</DialogTitle>
          <DialogDescription>「{{ deactivateTarget?.username }}」將無法登入，其掃描與通知會暫停；帳單與設定全數保留，可隨時還原。</DialogDescription>
        </DialogHeader>
        <DialogFooter class="gap-2 sm:gap-0">
          <DialogClose as-child><Button variant="outline">取消</Button></DialogClose>
          <Button variant="destructive" :disabled="submitting" @click="handleDeactivate">停用</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- Permanent delete confirm -->
    <Dialog :open="!!purgeTarget" @update:open="(v: boolean) => { if (!v) purgeTarget = null }">
      <DialogContent class="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>永久刪除</DialogTitle>
          <DialogDescription>確定要永久刪除「{{ purgeTarget?.username }}」嗎？其帳單、銀行、通知規則與掃描紀錄會一併刪除，此操作無法復原。</DialogDescription>
        </DialogHeader>
        <DialogFooter class="gap-2 sm:gap-0">
          <DialogClose as-child><Button variant="outline">取消</Button></DialogClose>
          <Button variant="destructive" :disabled="submitting" @click="handlePurge">確認永久刪除</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
```

Icon import: add `UserX` to the lucide-vue-next import (replaces `Trash2` usage in the active row; `Trash2` may be removed if unused).

- [ ] **Step 7: Build + commit**

Run: `pnpm --filter @bill-alarm/web generate` — exit 0.

```bash
git add apps/web/composables apps/web/types/settings.ts apps/web/pages/bills/[id].vue apps/web/components/settings/UsersCard.vue
git commit -m "feat(web): tenant-model composables, ungated bill actions, user lifecycle UI"
```

---

### Task 9: Web — settings v3 (everyone self-serve; admin system section)

**Files:**
- Create: `apps/web/components/settings/ScanConfigCard.vue`
- Modify: `apps/web/components/settings/IntegrationEmail.vue`
- Modify: `apps/web/pages/settings/index.vue`
- Modify: `apps/web/pages/index.vue` (onboarding hint)

**Interfaces:**
- Consumes: `getEmailStatus()` (Task 8), slim `getConfigStatus()`, calendar `getCalendarFeed()`.
- Produces: settings page where EVERY user manages own 信箱/行事曆/通知規則/TG綁定/帳號, and admin additionally sees 系統管理 (AI 解析器 / Telegram Bot / 掃描設定 / 使用者管理).

- [ ] **Step 1: Extract scan globals — create `apps/web/components/settings/ScanConfigCard.vue`**

Move the three scan rows (自動掃描頻率 / 掃描範圍 / 進階搜尋條件) out of IntegrationEmail into this admin-only component:

```vue
<script setup lang="ts">
import { ChevronDown, ChevronUp, Clock, Mail } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { SCAN_INTERVAL_OPTIONS } from '~/types/settings'

const props = defineProps<{
  scan: { interval: number; rangeDays: number; queryExtra: string }
}>()

const emit = defineEmits<{ refresh: [] }>()

const settingsApi = useSettingsApi()
const scanForm = ref({ rangeDays: props.scan.rangeDays, queryExtra: props.scan.queryExtra })
const showAdvancedScan = ref(false)

watch(() => props.scan, (v) => {
  scanForm.value.rangeDays = v.rangeDays
  scanForm.value.queryExtra = v.queryExtra
})

async function handleSaveScanConfig() {
  try {
    await settingsApi.saveScanConfig({
      rangeDays: scanForm.value.rangeDays,
      queryExtra: scanForm.value.queryExtra,
    })
    toast.success('掃描條件已更新')
    emit('refresh')
  } catch (e) {
    toast.error('更新失敗', { description: String(e) })
  }
}

async function handleScanIntervalChange(value: string) {
  const interval = parseInt(value)
  try {
    await settingsApi.saveScanInterval(interval)
    const label = SCAN_INTERVAL_OPTIONS.find(o => o.value === value)?.label ?? value
    toast.success(`掃描頻率已更新為「${label}」`)
    emit('refresh')
  } catch (e) {
    toast.error('更新失敗', { description: String(e) })
  }
}
</script>

<template>
  <div class="space-y-2">
    <p class="text-xs text-muted-foreground">全域掃描節奏，套用到所有成員的信箱。</p>
    <SettingsConfigRow label="自動掃描頻率" description="定時檢查所有成員信箱是否有新帳單。">
      <template #icon><Clock class="h-4 w-4 text-muted-foreground" /></template>
      <Select :model-value="String(scan.interval)" @update:model-value="handleScanIntervalChange">
        <SelectTrigger class="w-40">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem v-for="opt in SCAN_INTERVAL_OPTIONS" :key="opt.value" :value="opt.value">
            {{ opt.label }}
          </SelectItem>
        </SelectContent>
      </Select>
    </SettingsConfigRow>

    <SettingsConfigRow label="掃描範圍（天）" description="從幾天前開始搜尋郵件。預設 60 天。">
      <template #icon><Clock class="h-4 w-4 text-muted-foreground" /></template>
      <div class="flex gap-2">
        <Input v-model.number="scanForm.rangeDays" type="number" min="1" max="365" class="w-24" />
        <Button size="sm" variant="outline" @click="handleSaveScanConfig">儲存</Button>
      </div>
    </SettingsConfigRow>

    <SettingsConfigRow label="進階搜尋條件">
      <template #icon><Mail class="h-4 w-4 text-muted-foreground" /></template>
      <Button size="sm" variant="ghost" @click="showAdvancedScan = !showAdvancedScan">
        {{ showAdvancedScan ? '收合' : '展開' }}
        <component :is="showAdvancedScan ? ChevronUp : ChevronDown" class="ml-1 h-4 w-4" />
      </Button>
      <template v-if="showAdvancedScan" #below>
        <div class="mt-2 ml-6 space-y-2">
          <Input v-model="scanForm.queryExtra" placeholder="例：label:bills -from:noreply" class="font-mono text-sm" />
          <p class="text-xs text-muted-foreground">
            附加到掃描查詢字串。Gmail IMAP 支援完整 Gmail 搜尋語法。
          </p>
          <Button size="sm" variant="outline" @click="handleSaveScanConfig">儲存</Button>
        </div>
      </template>
    </SettingsConfigRow>
  </div>
</template>
```

- [ ] **Step 2: Slim `apps/web/components/settings/IntegrationEmail.vue`**

- Props become `{ email: EmailStatus }` (import type from `~/types/settings`; the `scan` prop, `scanForm`, `handleSaveScanConfig`, `handleScanIntervalChange`, `SCAN_INTERVAL_OPTIONS` import, and the entire "Settings rows" block with the three `SettingsConfigRow`s are REMOVED — they now live in ScanConfigCard).
- Field renames inside the template/script: `email.isConnected` → `email.connected` (the new per-user endpoint's shape).
- Everything else (cred form, test/save, 立即掃描 button + progress, help dialog) stays.

- [ ] **Step 3: Restructure `apps/web/pages/settings/index.vue`**

Script — replace the admin-only fetch model with a two-tier fetch:

```ts
const settingsApi = useSettingsApi()
const { me, isAdmin, logout } = useAuth()

const rules = ref<NotificationRule[]>([])
const emailStatus = ref<EmailStatus | null>(null)
const calendarFeed = ref<{ token: string; feedUrl: string; feedPath: string } | null>(null)
const configStatus = ref<ConfigStatus | null>(null)
const loading = ref(true)

async function fetchSelfData() {
  loading.value = true
  try {
    const [ruleList, email, calendar] = await Promise.all([
      settingsApi.listRules(),
      settingsApi.getEmailStatus(),
      settingsApi.getCalendarFeed(),
    ])
    rules.value = ruleList
    emailStatus.value = email
    calendarFeed.value = calendar
  } catch (error) {
    toast.error('載入設定失敗', { description: String(error) })
  } finally {
    loading.value = false
  }
}

async function fetchAdminData() {
  try {
    configStatus.value = await settingsApi.getConfigStatus()
  } catch (error) {
    toast.error('載入系統設定失敗', { description: String(error) })
  }
}

onMounted(fetchSelfData)
const adminDataFetched = ref(false)
watch(isAdmin, (admin) => {
  if (admin && !adminDataFetched.value) {
    adminDataFetched.value = true
    fetchAdminData()
  }
}, { immediate: true })
```

Status computeds update accordingly:

```ts
const emailCardStatus = computed<{ status: CardStatus, text: string }>(() => {
  const e = emailStatus.value
  if (!e?.hasCredentials) return { status: 'unset', text: '未設定' }
  return e.connected ? { status: 'ok', text: '已連線' } : { status: 'error', text: '連線失敗' }
})
```

(`telegramStatus`/`llmStatus` stay, driven by `configStatus` — admin-only cards.)

Template structure (full section layout):

```vue
    <!-- 服務整合（全員：自己的信箱與行事曆） -->
    <section class="space-y-3">
      <h2 class="text-sm font-medium text-muted-foreground">服務整合</h2>
      <div v-if="loading" class="space-y-3">
        <div v-for="i in 2" :key="i" class="h-12 animate-pulse rounded-xl bg-muted" />
      </div>
      <template v-else>
        <SettingsCard v-if="emailStatus" :icon="Mail" title="信箱（Gmail IMAP）" :status="emailCardStatus.status" :status-text="emailCardStatus.text">
          <SettingsIntegrationEmail :email="emailStatus" @refresh="fetchSelfData" />
        </SettingsCard>
        <SettingsCard v-if="calendarFeed" :icon="CalendarCheck" title="行事曆訂閱（ICS Feed）" status="ok" status-text="已啟用">
          <SettingsIntegrationCalendar :calendar="calendarFeed" @refresh="fetchSelfData" />
        </SettingsCard>
      </template>
    </section>

    <!-- 通知規則（全員，自己的） -->
    <section>
      <SettingsNotificationRuleList
        :rules="rules" :loading="loading"
        @create="openCreateDialog" @edit="openEditDialog" @delete="openDeleteDialog" @refresh="fetchSelfData"
      />
    </section>

    <!-- 帳號（全員） -->
    <section class="space-y-3">
      <h2 class="flex items-center gap-2 text-sm font-medium text-muted-foreground">
        <User class="h-4 w-4" />帳號
      </h2>
      <InstallPrompt variant="row" />
      <SettingsTelegramBindCard />
      <Card class="flex flex-wrap items-center justify-between gap-3 p-4">
        <!-- identity block + 修改密碼/登出 buttons: unchanged from current file -->
      </Card>
    </section>

    <!-- 系統管理（admin） -->
    <section v-if="isAdmin" class="space-y-3">
      <h2 class="text-sm font-medium text-muted-foreground">系統管理</h2>
      <template v-if="configStatus">
        <SettingsCard :icon="Sparkles" title="AI 解析器" :status="llmStatus.status" :status-text="llmStatus.text">
          <SettingsIntegrationLLM
            :llm="configStatus.llm" :gemini="configStatus.gemini" :openai="configStatus.openai"
            @refresh="fetchAdminData"
          />
        </SettingsCard>
        <SettingsCard :icon="Send" title="Telegram Bot" :status="telegramStatus.status" :status-text="telegramStatus.text">
          <SettingsIntegrationTelegram :status="configStatus.telegram" @refresh="fetchAdminData" />
        </SettingsCard>
        <SettingsCard :icon="Clock" title="掃描設定" status="ok" status-text="全域">
          <SettingsScanConfigCard :scan="configStatus.scan" @refresh="fetchAdminData" />
        </SettingsCard>
      </template>
      <SettingsUsersCard />
    </section>
```

Also: delete the member-only calendar card + `memberFeedUrl`/`copyFeedUrl` from the previous cycle (the shared IntegrationCalendar card now serves everyone); `Copy` import may drop; add `Clock` to the lucide import; rule dialogs keep `v-if` removed (rules are for everyone now) — `SettingsNotificationRuleDialog` loses its `v-if="isAdmin"`.

- [ ] **Step 4: Onboarding hint — `apps/web/pages/index.vue`**

In the script, alongside existing fetches:

```ts
const emailReady = ref(true)
onMounted(async () => {
  try {
    const s = await useSettingsApi().getEmailStatus()
    emailReady.value = s.hasCredentials
  } catch {
    // leave true — never block the overview on this hint
  }
})
```

In the template, directly under `<InstallPrompt variant="banner" />`:

```vue
    <Card v-if="!emailReady" class="border-primary/40 bg-primary/5 p-4 text-sm">
      <p class="font-medium">還差一步就能自動追蹤帳單</p>
      <p class="mt-1 text-muted-foreground">
        先到 <NuxtLink to="/settings" class="underline">設定 → 信箱</NuxtLink> 完成 IMAP 設定，再到
        <NuxtLink to="/banks" class="underline">銀行</NuxtLink> 啟用你的銀行。
      </p>
    </Card>
```

- [ ] **Step 5: Build + commit**

Run: `pnpm --filter @bill-alarm/web generate` — exit 0.

```bash
git add apps/web/components/settings apps/web/pages/settings/index.vue apps/web/pages/index.vue
git commit -m "feat(web): self-serve settings for every user, admin system section, onboarding hint"
```

---

### Task 10: Docs + full verification

**Files:**
- Modify: `README.md`
- Modify: `.claude/CLAUDE.md` (conventions section)

- [ ] **Step 1: README updates**

- Multi-tenant behavior paragraph: each user configures their own mailbox (設定 → 信箱), enables their own banks, has their own notification rules and personal calendar feed URL; admin manages users + global LLM/Telegram-bot/scan-cadence settings; deactivating a user pauses them (restorable), permanent delete wipes their data.
- Env deprecation note: `IMAP_HOST/IMAP_PORT/IMAP_USER/IMAP_PASSWORD/EMAIL_PROVIDER` env vars are no longer read — mailboxes are configured per user in the UI (also REMOVE those lines from `.env.example`).
- Upgrade note: no forced re-login; the admin inherits all existing data and the existing calendar URL keeps working.
- Recovery command section: unchanged SQL (`DELETE FROM users; DELETE FROM sessions;`), but update the prose: wiping users now ALSO orphans tenant data — recommend restoring from backup instead; the command remains the last-resort lockout escape.

- [ ] **Step 2: `.claude/CLAUDE.md`** — update the conventions bullet `Single-user auth: ...` to:

```markdown
- Multi-tenant auth: users table (unique admin + members, soft delete via deletedAt), scrypt passwords, 30-day rolling cookie sessions; ADMIN_ONLY route list in `routes/auth.ts` authGuard; every data route self-scopes by `getAuthUser(c).id`
```

- [ ] **Step 3: Full verification**

```bash
pnpm --filter @bill-alarm/server test
pnpm --filter @bill-alarm/web generate
```

Expected: all server tests pass; generate exit 0.

- [ ] **Step 4: Commit**

```bash
git add README.md .env.example .claude/CLAUDE.md
git commit -m "docs: multi-tenant behavior, env deprecations, lifecycle notes"
```
