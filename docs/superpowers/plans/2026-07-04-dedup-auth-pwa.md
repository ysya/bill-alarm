# 重複帳單修復 + 帳密認證 + PWA 實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 消除 LLM 期別輪盤造成的重複帳單，為 app 加上單人帳密認證（為拆除 Cloudflare Access 做準備），並讓 Nuxt 前端成為可安裝的 PWA。

**Architecture:** 三個獨立階段。Phase 1 在掃描管線加入以穩定識別碼為主的去重防線（sourceEmailId 短路 + 同銀行/金額/到期日近似重複防護）並穩定 LLM 輸出；Phase 2 在 Hono 加 scrypt 帳密 + SQLite session + cookie middleware，Nuxt 加 login/setup 頁與全域路由守衛；Phase 3 用 @vite-pwa/nuxt 產生 manifest/service worker。

**Tech Stack:** Hono 4 + Prisma 7（better-sqlite3 adapter）+ vitest（新增）；Nuxt 4 SPA（`ssr: false`）+ shadcn-vue + @vite-pwa/nuxt。

**Spec:** `docs/superpowers/specs/2026-07-04-pwa-auth-dedup-design.md`

## Global Constraints

- 全 repo 為 ESM：server 端 import 一律帶 `.js` 副檔名（如 `import prisma from '@/prisma.js'`）。
- server 端路徑別名 `@/` = `apps/server/src/`（tsconfig paths；vitest 需另設 alias）。
- UI 文案一律繁體中文（台灣）；程式碼與 commit message 英文，conventional commits 格式。
- **不可修改**這些檔案（另一工作階段的未提交變更）：`apps/server/src/parsers/hsbc.ts`、`apps/web/components/settings/NotificationRuleDialog.vue`、`apps/web/components/settings/NotificationRuleList.vue`、`apps/web/pages/banks/index.vue`。
- 新依賴僅限：`vitest`（server devDep）、`@vite-pwa/nuxt`、`@vite-pwa/assets-generator`（web devDep）。不引入原生編譯依賴。
- Prisma 7 設定在 `apps/server/prisma.config.ts`，`DATABASE_URL` 環境變數可覆寫資料庫位置（測試用）。
- Settings 鍵值慣例：`KEYS` 常數 snake_case 字串（見 `apps/server/src/services/settings.ts:4`）。
- 所有指令在 repo root（`/Users/ysya/project/homelab/bill-alarm`）執行，除非另註明。

---

## Phase 1 — 掃描去重（server）

### Task 1: vitest 基礎 + `parseBillResponse` 月底溢位修復

**Files:**
- Modify: `apps/server/package.json`（加 vitest + test script）
- Create: `apps/server/vitest.config.ts`
- Modify: `apps/server/src/services/llm-parser.ts:218`（export + 溢位修復）
- Create: `apps/server/src/services/__tests__/llm-parser.test.ts`

**Interfaces:**
- Produces: `parseBillResponse(raw: string): ParsedBill | null`（由 private 改為 export，供測試與既有內部呼叫）

- [ ] **Step 1: 安裝 vitest 並加 script**

```bash
pnpm --filter @bill-alarm/server add -D vitest
```

在 `apps/server/package.json` 的 `scripts` 加：

```json
"test": "vitest run",
"test:watch": "vitest"
```

（pnpm 對 peer 版本非嚴格，vitest 內嵌自己的 vite，與專案的 vite 8 dev server 不衝突。）

- [ ] **Step 2: 建 `apps/server/vitest.config.ts`**

```ts
import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
    },
  },
  test: {
    environment: 'node',
    // DB 相關測試共用同一個 SQLite 檔，避免平行寫入衝突
    fileParallelism: false,
  },
})
```

- [ ] **Step 3: 寫失敗測試**

建 `apps/server/src/services/__tests__/llm-parser.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { parseBillResponse } from '../llm-parser.js'

describe('parseBillResponse', () => {
  it('uses LLM billingPeriod when valid', () => {
    const bill = parseBillResponse(JSON.stringify({
      amount: 1000, minimumPayment: 100, dueDate: '2026-07-13', billingPeriod: '2026-06',
    }))
    expect(bill?.billingPeriod).toBe('2026-06')
  })

  it('derives previous month without end-of-month overflow', () => {
    // 舊實作 setMonth(-1) 在 3/31 會溢位成 3 月；正確應為 2 月
    const bill = parseBillResponse(JSON.stringify({
      amount: 1000, minimumPayment: null, dueDate: '2026-03-31', billingPeriod: null,
    }))
    expect(bill?.billingPeriod).toBe('2026-02')
  })

  it('crosses year boundary for January due dates', () => {
    const bill = parseBillResponse(JSON.stringify({
      amount: 1000, minimumPayment: null, dueDate: '2026-01-15', billingPeriod: null,
    }))
    expect(bill?.billingPeriod).toBe('2025-12')
  })

  it('returns null for unparseable payloads', () => {
    expect(parseBillResponse('not json')).toBeNull()
    expect(parseBillResponse(JSON.stringify({ amount: null, dueDate: '2026-01-01' }))).toBeNull()
  })
})
```

- [ ] **Step 4: 跑測試確認失敗**

Run: `pnpm --filter @bill-alarm/server test`
Expected: FAIL — `parseBillResponse` is not exported（或 3/31 案例回 `2026-03`）

- [ ] **Step 5: 修改 `llm-parser.ts`**

`apps/server/src/services/llm-parser.ts:218` 的 `function parseBillResponse` 改為 `export function parseBillResponse`，並把 fallback 區塊（原 227–234 行）：

```ts
    let billingPeriod: string
    if (typeof data.billingPeriod === 'string' && /^\d{4}-\d{2}$/.test(data.billingPeriod)) {
      billingPeriod = data.billingPeriod
    } else {
      const d = new Date(dueDate)
      d.setMonth(d.getMonth() - 1)
      billingPeriod = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    }
```

改為（純年月運算，避免 Date 借位）：

```ts
    let billingPeriod: string
    if (typeof data.billingPeriod === 'string' && /^\d{4}-\d{2}$/.test(data.billingPeriod)) {
      billingPeriod = data.billingPeriod
    } else {
      // Derive previous month from due date; month arithmetic only, so
      // end-of-month dates (29-31) can't overflow into the wrong month.
      const y = dueDate.getUTCFullYear()
      const m = dueDate.getUTCMonth() // 0-based; equals previous month in 1-based terms
      const prevYear = m === 0 ? y - 1 : y
      const prevMonth = m === 0 ? 12 : m
      billingPeriod = `${prevYear}-${String(prevMonth).padStart(2, '0')}`
    }
```

- [ ] **Step 6: 跑測試確認通過**

Run: `pnpm --filter @bill-alarm/server test`
Expected: 4 passed

- [ ] **Step 7: Commit**

```bash
git add apps/server/package.json apps/server/vitest.config.ts apps/server/src/services/llm-parser.ts apps/server/src/services/__tests__/llm-parser.test.ts pnpm-lock.yaml
git commit -m "fix(scan): month-end overflow in billingPeriod fallback + vitest setup"
```

---

### Task 2: 三個 LLM provider 設 temperature 0

**Files:**
- Modify: `apps/server/src/services/llm-parser.ts:133-215`（三個 invoke 函式）

**Interfaces:** 無對外變更（僅 provider 呼叫參數）。

- [ ] **Step 1: Gemini — `invokeGemini`（原 133–150 行）**

`generateContent` 的參數改為永遠帶 `config`，`temperature: 0`：

```ts
  const response = await ai.models.generateContent({
    model,
    contents: prompt,
    config: {
      temperature: 0,
      ...(schema && {
        responseMimeType: 'application/json',
        responseJsonSchema: schema,
      }),
    },
  })
```

- [ ] **Step 2: OpenAI — `invokeOpenAI` 的 body（原 158–161 行）**

```ts
  const body: Record<string, unknown> = {
    model,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0,
  }
```

- [ ] **Step 3: Ollama — `invokeOllama` 的 options（原 205 行）**

`options: { temperature: 0.1 }` → `options: { temperature: 0 }`

- [ ] **Step 4: 確認既有測試不破**

Run: `pnpm --filter @bill-alarm/server test`
Expected: 4 passed

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/services/llm-parser.ts
git commit -m "fix(scan): set temperature 0 for all LLM providers to stabilize output"
```

---

### Task 3: sourceEmailId 短路 + 近似重複防護 + PDF 檔名防覆寫

**Files:**
- Modify: `apps/server/src/index.ts:53`（scheduler 測試環境守衛）
- Modify: `apps/server/src/services/email-parser.ts`（兩個 export 查詢 helper + 迴圈接線 + 檔名）
- Create: `apps/server/src/services/__tests__/helpers/test-db.ts`
- Create: `apps/server/src/services/__tests__/email-parser-dedup.test.ts`

**Interfaces:**
- Produces:
  - `emailAlreadyProcessed(msgId: string): Promise<boolean>`（email-parser.ts export）
  - `duplicateBillExists(bankId: string, amount: number, dueDate: Date): Promise<boolean>`（email-parser.ts export）
  - `setupTestDb(): string`（test helper；設定 `process.env.DATABASE_URL` 指向暫存 SQLite 並 `prisma db push`，回傳 url。**必須在 import 任何 `@/` 模組之前呼叫**）

- [ ] **Step 1: scheduler 測試守衛**

`apps/server/src/index.ts:52-53`：

```ts
// Start scheduler (skipped under vitest — importing the app must not start cron)
if (!process.env.VITEST) startScheduler()
```

- [ ] **Step 2: 建立 test-db helper**

建 `apps/server/src/services/__tests__/helpers/test-db.ts`：

```ts
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/**
 * Point DATABASE_URL at a fresh temp SQLite file and create the schema.
 * MUST be called before importing '@/prisma.js' (or anything that imports it).
 */
export function setupTestDb(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bill-alarm-test-'))
  const url = `file:${path.join(dir, 'test.db')}`
  process.env.DATABASE_URL = url
  const serverRoot = path.resolve(import.meta.dirname, '../../../..')
  execSync('pnpm exec prisma db push --skip-generate', {
    cwd: serverRoot,
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  })
  return url
}
```

- [ ] **Step 3: 寫失敗測試**

建 `apps/server/src/services/__tests__/email-parser-dedup.test.ts`（注意：`setupTestDb()` 在最上方先跑，其餘用動態 import 才不會被 hoist 搶先初始化 prisma）：

```ts
import { describe, it, expect, beforeAll } from 'vitest'
import { setupTestDb } from './helpers/test-db.js'

setupTestDb()

const { emailAlreadyProcessed, duplicateBillExists } = await import('../email-parser.js')
const { default: prisma } = await import('@/prisma.js')

describe('scan dedup guards', () => {
  let bankId: string

  beforeAll(async () => {
    const bank = await prisma.bank.create({
      data: { name: '測試銀行', emailSenderPattern: 'test@bank', emailSubjectPattern: '帳單' },
    })
    bankId = bank.id
    await prisma.bill.create({
      data: {
        bankId,
        billingPeriod: '2026-05',
        amount: 7100,
        dueDate: new Date('2026-06-08'),
        sourceEmailId: '46567',
      },
    })
  })

  it('emailAlreadyProcessed: true for a msgId that already produced a bill', async () => {
    expect(await emailAlreadyProcessed('46567')).toBe(true)
  })

  it('emailAlreadyProcessed: false for unseen msgId', async () => {
    expect(await emailAlreadyProcessed('99999')).toBe(false)
  })

  it('duplicateBillExists: true for same bank+amount+dueDate even with different period', async () => {
    // 滙豐案例：provider 遷移後同帳單換了 msgId，只有這道防線擋得住
    expect(await duplicateBillExists(bankId, 7100, new Date('2026-06-08'))).toBe(true)
  })

  it('duplicateBillExists: false when amount differs', async () => {
    expect(await duplicateBillExists(bankId, 9999, new Date('2026-06-08'))).toBe(false)
  })
})
```

- [ ] **Step 4: 跑測試確認失敗**

Run: `pnpm --filter @bill-alarm/server test`
Expected: FAIL — `emailAlreadyProcessed` is not exported

- [ ] **Step 5: 實作 helpers 並接線**

`apps/server/src/services/email-parser.ts` — 在 `scanAndProcessEmails` 函式定義前加：

```ts
/** True if this email already produced a bill (stable-ID dedup, first line of defense). */
export async function emailAlreadyProcessed(msgId: string): Promise<boolean> {
  return (await prisma.bill.count({ where: { sourceEmailId: msgId } })) > 0
}

/** True if a bill with the same bank/amount/dueDate exists — catches the same
 *  statement re-ingested under a different email ID (e.g. provider migration). */
export async function duplicateBillExists(bankId: string, amount: number, dueDate: Date): Promise<boolean> {
  return (await prisma.bill.count({ where: { bankId, amount, dueDate } })) > 0
}
```

迴圈接線一（`email-parser.ts:119` 的 `try {` 之後、`session.fetch` 之前）：

```ts
        try {
          if (await emailAlreadyProcessed(msgId)) {
            progressReason = '此信件已建立過帳單'
            continue
          }
          const email = await session.fetch(msgRef)
```

迴圈接線二（原 238–241 行 `if (existing)` 區塊之後、存 PDF 之前）：

```ts
          if (await duplicateBillExists(bank.id, parsed.amount, parsed.dueDate)) {
            progressReason = '已存在同金額同到期日帳單'
            continue
          }
```

檔名（原 245 行）：

```ts
            const filename = `${bank.code ?? bank.id}_${msgId.replace(/[^A-Za-z0-9_-]/g, '')}.pdf`
```

- [ ] **Step 6: 跑測試確認通過**

Run: `pnpm --filter @bill-alarm/server test`
Expected: 全部 passed（llm-parser 4 + dedup 4）

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/index.ts apps/server/src/services/email-parser.ts apps/server/src/services/__tests__/
git commit -m "fix(scan): dedup by sourceEmailId + near-duplicate guard, msgId-based pdf filename"
```

---

### Task 4: 掃描路徑接回 hardcoded parsers（template → hardcoded → LLM）

**Files:**
- Modify: `apps/server/src/parsers/registry.ts`（新 export）
- Modify: `apps/server/src/services/email-parser.ts:176-211`（parse 順序）
- Create: `apps/server/src/parsers/__tests__/registry.test.ts`

**Interfaces:**
- Produces: `getHardcodedParser(bankCode: string | null): BillEmailParser | null`（registry.ts export；與既有 `getParser` 不同 — 查無時回 `null` 而非 generic fallback）
- 注意：**不可改 `parsers/hsbc.ts`**（工作區有另一份未提交修改）。

- [ ] **Step 1: 寫失敗測試**

建 `apps/server/src/parsers/__tests__/registry.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { getHardcodedParser } from '../registry.js'

describe('getHardcodedParser', () => {
  it('returns the parser for a registered bank code', () => {
    expect(getHardcodedParser('esun')?.bankCode).toBe('esun')
  })

  it('returns null for unknown code or null', () => {
    expect(getHardcodedParser('nonexistent')).toBeNull()
    expect(getHardcodedParser(null)).toBeNull()
  })
})
```

Run: `pnpm --filter @bill-alarm/server test`
Expected: FAIL — `getHardcodedParser` is not exported

- [ ] **Step 2: registry.ts 加 export**

`apps/server/src/parsers/registry.ts`（`getParser` 之後）：

```ts
/** Bank-specific parser only — null when the bank has none (no generic fallback). */
export function getHardcodedParser(bankCode: string | null): BillEmailParser | null {
  return (bankCode && parsers.get(bankCode)) || null
}
```

- [ ] **Step 3: email-parser.ts 插入 hardcoded 階段**

`apps/server/src/services/email-parser.ts`：

import 區加：

```ts
import { getHardcodedParser } from '@/parsers/registry.js'
```

原 176–177 行的 source 型別加上 `'hardcoded'`：

```ts
          let parsed: ParsedBill | null = null
          let source: 'template' | 'hardcoded' | 'llm' | null = null
```

在 template 區塊（原 179–190 行）之後、LLM 區塊（原 192 行 `if (!parsed)`）之前插入：

```ts
          if (!parsed) {
            const hardcoded = getHardcodedParser(bank.code)
            if (hardcoded) {
              const bill = hardcoded.parse(pdfText)
              if (bill) {
                parsed = bill
                source = 'hardcoded'
              }
            }
          }
```

- [ ] **Step 4: 跑測試 + lint**

Run: `pnpm --filter @bill-alarm/server test && pnpm lint`
Expected: 全部 passed、lint 無新錯誤

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/parsers/registry.ts apps/server/src/parsers/__tests__/registry.test.ts apps/server/src/services/email-parser.ts
git commit -m "feat(scan): try hardcoded bank parsers before LLM fallback"
```

---

## Phase 2 — 帳密認證

### Task 5: Session model + scrypt 密碼服務

**Files:**
- Modify: `apps/server/prisma/schema.prisma`（Session model）
- Modify: `apps/server/src/services/settings.ts:4`（KEYS 加兩鍵）
- Create: `apps/server/src/services/auth.ts`
- Create: `apps/server/src/services/__tests__/auth.test.ts`

**Interfaces:**
- Produces:
  - `hashPassword(password: string): string`（格式 `saltHex:hashHex`）
  - `verifyPassword(password: string, stored: string): boolean`
  - Prisma model `Session { id, tokenHash(unique), createdAt, expiresAt, lastExtendedAt }`
  - `KEYS.AUTH_USERNAME = 'auth_username'`、`KEYS.AUTH_PASSWORD_HASH = 'auth_password_hash'`

- [ ] **Step 1: schema 加 Session model**

`apps/server/prisma/schema.prisma` 末尾加：

```prisma
model Session {
  id             String   @id @default(uuid(7))
  tokenHash      String   @unique
  createdAt      DateTime @default(now())
  expiresAt      DateTime
  lastExtendedAt DateTime @default(now())

  @@map("sessions")
}
```

- [ ] **Step 2: 建 migration**

```bash
pnpm --filter @bill-alarm/server exec prisma migrate dev --name add_sessions
```

Expected: 新資料夾 `apps/server/prisma/migrations/<timestamp>_add_sessions/`，client 重新生成。（部署時 Dockerfile 的 `prisma migrate deploy` 會自動套用。）

- [ ] **Step 3: KEYS 加鍵**

`apps/server/src/services/settings.ts` 的 `KEYS` 物件加（放在 LLM 區塊後）：

```ts
  // Auth (single user)
  AUTH_USERNAME: 'auth_username',
  AUTH_PASSWORD_HASH: 'auth_password_hash',  // scrypt, "saltHex:hashHex"
```

- [ ] **Step 4: 寫失敗測試**

建 `apps/server/src/services/__tests__/auth.test.ts`（密碼部分；session 測試在 Task 6 加進同檔）：

```ts
import { describe, it, expect } from 'vitest'
import { setupTestDb } from './helpers/test-db.js'

setupTestDb()

const { hashPassword, verifyPassword } = await import('../auth.js')

describe('password hashing', () => {
  it('verifies a correct password', () => {
    const stored = hashPassword('correct horse battery staple')
    expect(verifyPassword('correct horse battery staple', stored)).toBe(true)
  })

  it('rejects a wrong password', () => {
    const stored = hashPassword('correct horse battery staple')
    expect(verifyPassword('wrong', stored)).toBe(false)
  })

  it('produces unique salts', () => {
    expect(hashPassword('a')).not.toBe(hashPassword('a'))
  })

  it('rejects malformed stored values', () => {
    expect(verifyPassword('a', 'garbage')).toBe(false)
  })
})
```

Run: `pnpm --filter @bill-alarm/server test`
Expected: FAIL — Cannot find module '../auth.js'

- [ ] **Step 5: 建 `apps/server/src/services/auth.ts`（密碼部分）**

```ts
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import prisma from '@/prisma.js'

// scrypt parameters — interactive-login strength, no native deps
const SCRYPT = { N: 16384, r: 8, p: 1 }
const KEYLEN = 32

export function hashPassword(password: string): string {
  const salt = randomBytes(16)
  const hash = scryptSync(password, salt, KEYLEN, SCRYPT)
  return `${salt.toString('hex')}:${hash.toString('hex')}`
}

export function verifyPassword(password: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(':')
  if (!saltHex || !hashHex) return false
  const expected = Buffer.from(hashHex, 'hex')
  if (expected.length !== KEYLEN) return false
  const actual = scryptSync(password, Buffer.from(saltHex, 'hex'), KEYLEN, SCRYPT)
  return timingSafeEqual(actual, expected)
}
```

（`createHash`、`prisma` import 供 Task 6 使用，先放著會有 unused warning 的話等 Task 6 一起處理，或先只 import 需要的，Task 6 再補。建議先只 import `randomBytes, scryptSync, timingSafeEqual`。）

- [ ] **Step 6: 跑測試確認通過**

Run: `pnpm --filter @bill-alarm/server test`
Expected: 全部 passed

- [ ] **Step 7: Commit**

```bash
git add apps/server/prisma/ apps/server/src/services/settings.ts apps/server/src/services/auth.ts apps/server/src/services/__tests__/auth.test.ts
git commit -m "feat(auth): session model, auth setting keys, scrypt password hashing"
```

---

### Task 6: Session 建立/驗證/銷毀（30 天滾動續期）

**Files:**
- Modify: `apps/server/src/services/auth.ts`
- Modify: `apps/server/src/services/__tests__/auth.test.ts`

**Interfaces:**
- Produces:
  - `createSession(): Promise<{ token: string; expiresAt: Date }>`
  - `validateSession(token: string): Promise<boolean>`（有效時若距上次展延 >24h 自動滾動續期 30 天）
  - `destroySession(token: string): Promise<void>`
- Consumes: Task 5 的 Session model。

- [ ] **Step 1: 加失敗測試（同檔 auth.test.ts 追加）**

```ts
const { createSession, validateSession, destroySession } = await import('../auth.js')
const { default: prisma } = await import('@/prisma.js')

describe('sessions', () => {
  it('creates a session validatable by its token', async () => {
    const { token } = await createSession()
    expect(await validateSession(token)).toBe(true)
  })

  it('stores only the token hash, not the token', async () => {
    const { token } = await createSession()
    const rows = await prisma.session.findMany()
    expect(rows.some(r => r.tokenHash === token)).toBe(false)
  })

  it('rejects unknown and destroyed tokens', async () => {
    expect(await validateSession('deadbeef')).toBe(false)
    const { token } = await createSession()
    await destroySession(token)
    expect(await validateSession(token)).toBe(false)
  })

  it('rejects expired sessions', async () => {
    const { token } = await createSession()
    await prisma.session.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } })
    expect(await validateSession(token)).toBe(false)
  })

  it('extends expiry when last extension is older than 24h', async () => {
    const { token } = await createSession()
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000)
    await prisma.session.updateMany({ data: { lastExtendedAt: old } })
    expect(await validateSession(token)).toBe(true)
    const row = (await prisma.session.findMany())[0]
    expect(row.lastExtendedAt.getTime()).toBeGreaterThan(old.getTime())
  })
})
```

Run: `pnpm --filter @bill-alarm/server test`
Expected: FAIL — createSession is not exported

- [ ] **Step 2: auth.ts 加 session 實作**

```ts
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 days, rolling
const EXTEND_AFTER_MS = 24 * 60 * 60 * 1000

function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export async function createSession(): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS)
  await prisma.session.create({ data: { tokenHash: tokenHash(token), expiresAt } })
  // opportunistic cleanup of expired rows
  await prisma.session.deleteMany({ where: { expiresAt: { lt: new Date() } } })
  return { token, expiresAt }
}

export async function validateSession(token: string): Promise<boolean> {
  const session = await prisma.session.findUnique({ where: { tokenHash: tokenHash(token) } })
  if (!session || session.expiresAt.getTime() < Date.now()) return false
  if (Date.now() - session.lastExtendedAt.getTime() > EXTEND_AFTER_MS) {
    await prisma.session.update({
      where: { id: session.id },
      data: { expiresAt: new Date(Date.now() + SESSION_TTL_MS), lastExtendedAt: new Date() },
    })
  }
  return true
}

export async function destroySession(token: string): Promise<void> {
  await prisma.session.deleteMany({ where: { tokenHash: tokenHash(token) } })
}
```

（此時把 Step 5/Task 5 註記的 `createHash`、`prisma` import 補齊。）

- [ ] **Step 3: 跑測試確認通過**

Run: `pnpm --filter @bill-alarm/server test`
Expected: 全部 passed

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/services/auth.ts apps/server/src/services/__tests__/auth.test.ts
git commit -m "feat(auth): session create/validate/destroy with 30-day rolling expiry"
```

---

### Task 7: auth routes + middleware + 掛載與整合測試

**Files:**
- Create: `apps/server/src/routes/auth.ts`
- Modify: `apps/server/src/index.ts`（middleware + route 掛載）
- Create: `apps/server/src/routes/__tests__/auth-flow.test.ts`

**Interfaces:**
- Produces:
  - `POST /api/auth/setup`（未初始化才可用；成功即登入）
  - `POST /api/auth/login`、`POST /api/auth/logout`、`GET /api/auth/me`
  - `GET /api/auth/status` → `{ initialized: boolean }`（白名單，前端判斷導 /login 或 /setup）
  - Cookie `ba_session`（httpOnly、sameSite=Lax、path=/、production 才 secure、expires=30 天）
  - 白名單：`/api/health`、`/api/auth/login`、`/api/auth/setup`、`/api/auth/status`、`/api/calendar/feed/*`
  - `_resetAuthRateLimit()`（僅供測試）
- Consumes: Task 5/6 的 `hashPassword/verifyPassword/createSession/validateSession/destroySession`、`KEYS.AUTH_*`。

- [ ] **Step 1: 寫失敗整合測試**

建 `apps/server/src/routes/__tests__/auth-flow.test.ts`（用 Hono 的 `app.request`，不起真的 server）：

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { setupTestDb } from '../../services/__tests__/helpers/test-db.js'

setupTestDb()

const { default: app } = await import('@/index.js')
const { _resetAuthRateLimit } = await import('../auth.js')

const CREDS = { username: 'frank', password: 'super-secret-pw' }

function cookieOf(res: Response): string {
  return res.headers.get('set-cookie')?.split(';')[0] ?? ''
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
})
```

Run: `pnpm --filter @bill-alarm/server test`
Expected: FAIL — Cannot find module '../auth.js'（routes）

- [ ] **Step 2: 建 `apps/server/src/routes/auth.ts`**

```ts
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
```

- [ ] **Step 3: index.ts 掛載**

`apps/server/src/index.ts` — import 區加：

```ts
import authRoutes, { authGuard } from './routes/auth.js'
```

`app.use('/api/*', cors())` 之後、路由掛載之前加 guard；路由區加 auth：

```ts
app.use('/api/*', cors())
app.use('/api/*', authGuard)

// API routes
app.get('/api/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }))
app.route('/api/auth', authRoutes)
```

- [ ] **Step 4: 跑測試確認通過**

Run: `pnpm --filter @bill-alarm/server test`
Expected: 全部 passed（含 auth-flow 5 條）

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/routes/auth.ts apps/server/src/routes/__tests__/auth-flow.test.ts apps/server/src/index.ts
git commit -m "feat(auth): auth routes, session cookie, api guard with whitelist"
```

---

### Task 8: 前端認證（login/setup 頁 + 全域守衛 + 401 攔截 + 登出）

**Files:**
- Create: `apps/web/composables/useAuth.ts`
- Create: `apps/web/middleware/auth.global.ts`
- Create: `apps/web/pages/login.vue`
- Create: `apps/web/pages/setup.vue`
- Modify: `apps/web/composables/useApi.ts`（401 攔截）
- Modify: `apps/web/app.vue`（login/setup 用無側欄殼）
- Modify: `apps/web/pages/settings/index.vue`（登出按鈕；若該頁結構為 tabs，放最外層底部即可）

**Interfaces:**
- Consumes: Task 7 的 `/api/auth/*` 端點與 401 行為。
- Produces: `useAuthed(): Ref<boolean | null>`（全域登入狀態）。

- [ ] **Step 1: `apps/web/composables/useAuth.ts`**

```ts
export const useAuthed = () => useState<boolean | null>('authed', () => null)

export function useAuth() {
  const authed = useAuthed()

  async function logout(): Promise<void> {
    await $fetch('/api/auth/logout', { method: 'POST' })
    authed.value = false
    await navigateTo('/login')
  }

  return { authed, logout }
}
```

- [ ] **Step 2: `apps/web/middleware/auth.global.ts`**

```ts
export default defineNuxtRouteMiddleware(async (to) => {
  if (to.path === '/login' || to.path === '/setup') return

  const authed = useAuthed()
  if (authed.value === true) return

  try {
    await $fetch('/api/auth/me')
    authed.value = true
  }
  catch {
    const status = await $fetch<{ initialized: boolean }>('/api/auth/status')
      .catch(() => ({ initialized: true }))
    return navigateTo(status.initialized ? '/login' : '/setup')
  }
})
```

- [ ] **Step 3: useApi.ts 加 401 攔截**

`apps/web/composables/useApi.ts` 整檔改為：

```ts
export function useApi() {
  const baseURL = '/api'

  const apiFetch = $fetch.create({
    onResponseError({ response }) {
      if (response.status === 401) {
        useAuthed().value = false
        navigateTo('/login')
      }
    },
  })

  async function get<T>(path: string): Promise<T> {
    return apiFetch<T>(`${baseURL}${path}`)
  }

  async function post<T>(path: string, body?: unknown): Promise<T> {
    return apiFetch<T>(`${baseURL}${path}`, { method: 'POST', body })
  }

  async function patch<T>(path: string, body?: unknown): Promise<T> {
    return apiFetch<T>(`${baseURL}${path}`, { method: 'PATCH', body })
  }

  async function del<T>(path: string): Promise<T> {
    return apiFetch<T>(`${baseURL}${path}`, { method: 'DELETE' })
  }

  return { get, post, patch, del }
}
```

- [ ] **Step 4: `apps/web/pages/login.vue`**

```vue
<template>
  <div class="min-h-screen flex items-center justify-center p-4">
    <Card class="w-full max-w-sm">
      <CardHeader>
        <CardTitle>登入 Bill Alarm</CardTitle>
      </CardHeader>
      <CardContent>
        <form class="flex flex-col gap-4" @submit.prevent="submit">
          <div class="flex flex-col gap-2">
            <Label for="username">帳號</Label>
            <Input id="username" v-model="username" autocomplete="username" required />
          </div>
          <div class="flex flex-col gap-2">
            <Label for="password">密碼</Label>
            <Input id="password" v-model="password" type="password" autocomplete="current-password" required />
          </div>
          <Button type="submit" :disabled="loading">
            {{ loading ? '登入中…' : '登入' }}
          </Button>
        </form>
      </CardContent>
    </Card>
  </div>
</template>

<script setup lang="ts">
import { toast } from 'vue-sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const username = ref('')
const password = ref('')
const loading = ref(false)

async function submit() {
  loading.value = true
  try {
    await $fetch('/api/auth/login', {
      method: 'POST',
      body: { username: username.value, password: password.value },
    })
    useAuthed().value = true
    await navigateTo('/')
  }
  catch (e) {
    const err = e as { response?: { status: number }, data?: { error?: string } }
    toast.error(err.data?.error ?? '登入失敗')
  }
  finally {
    loading.value = false
  }
}
</script>
```

- [ ] **Step 5: `apps/web/pages/setup.vue`**

```vue
<template>
  <div class="min-h-screen flex items-center justify-center p-4">
    <Card class="w-full max-w-sm">
      <CardHeader>
        <CardTitle>初始化管理帳號</CardTitle>
        <CardDescription>首次使用，請設定登入帳號與密碼。</CardDescription>
      </CardHeader>
      <CardContent>
        <form class="flex flex-col gap-4" @submit.prevent="submit">
          <div class="flex flex-col gap-2">
            <Label for="username">帳號</Label>
            <Input id="username" v-model="username" autocomplete="username" required />
          </div>
          <div class="flex flex-col gap-2">
            <Label for="password">密碼（至少 8 碼）</Label>
            <Input id="password" v-model="password" type="password" autocomplete="new-password" minlength="8" required />
          </div>
          <div class="flex flex-col gap-2">
            <Label for="confirm">確認密碼</Label>
            <Input id="confirm" v-model="confirm" type="password" autocomplete="new-password" minlength="8" required />
          </div>
          <Button type="submit" :disabled="loading">
            {{ loading ? '設定中…' : '完成設定' }}
          </Button>
        </form>
      </CardContent>
    </Card>
  </div>
</template>

<script setup lang="ts">
import { toast } from 'vue-sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const username = ref('')
const password = ref('')
const confirm = ref('')
const loading = ref(false)

async function submit() {
  if (password.value !== confirm.value) {
    toast.error('兩次輸入的密碼不一致')
    return
  }
  loading.value = true
  try {
    await $fetch('/api/auth/setup', {
      method: 'POST',
      body: { username: username.value, password: password.value },
    })
    useAuthed().value = true
    await navigateTo('/')
  }
  catch (e) {
    const err = e as { data?: { error?: string } }
    toast.error(err.data?.error ?? '設定失敗')
  }
  finally {
    loading.value = false
  }
}
</script>
```

- [ ] **Step 6: app.vue 無側欄殼**

`apps/web/app.vue` 的 `<template>` 最外層改為（script 區加 `const route = useRoute()` 與 `const bareShell = computed(() => route.path === '/login' || route.path === '/setup')`）：

```vue
<template>
  <div class="min-h-screen bg-background text-foreground">
    <template v-if="bareShell">
      <NuxtPage />
    </template>
    <div v-else class="flex">
      <!-- 既有 sidebar / mobile header / main 內容原封不動放這裡 -->
    </div>
    <Sonner position="top-right" />
  </div>
</template>
```

（既有的 `<div class="flex">…</div>` 整塊保留，只是外面多包 `v-else`。）

- [ ] **Step 7: settings 頁加登出**

在 `apps/web/pages/settings/index.vue` 頁面內容底部加（import 對齊該檔既有寫法）：

```vue
<Button variant="destructive" class="mt-6" @click="logout">登出</Button>
```

```ts
const { logout } = useAuth()
```

- [ ] **Step 8: 手動驗證（dev）**

```bash
pnpm dev:server   # :3100
pnpm dev:web      # :3001
```

檢查清單：
1. 開 `http://localhost:3001` → 自動導向 `/setup`（全新 dev DB）或 `/login`。
2. Setup 完成 → 進入總覽，重新整理仍保持登入。
3. `curl -i http://localhost:3100/api/bills` → 401；`curl -i http://localhost:3100/api/health` → 200。
4. 設定頁登出 → 回 `/login`，再訪問任何頁都被導回。
5. 錯密碼連打 5 次 → 第 6 次顯示鎖定訊息。

- [ ] **Step 9: lint + commit**

```bash
pnpm lint
git add apps/web/composables/useAuth.ts apps/web/composables/useApi.ts apps/web/middleware/ apps/web/pages/login.vue apps/web/pages/setup.vue apps/web/app.vue apps/web/pages/settings/index.vue
git commit -m "feat(auth): login/setup pages, global route guard, 401 interception, logout"
```

---

## Phase 3 — PWA

### Task 9: @vite-pwa/nuxt + icons + manifest

**Files:**
- Modify: `apps/web/package.json`（兩個 devDep + assets script）
- Create: `apps/web/public/logo.svg`（icon 來源）
- Create: `apps/web/pwa-assets.config.ts`
- Modify: `apps/web/nuxt.config.ts`（module + pwa 設定 + apple meta/links）

**Interfaces:**
- Consumes: 既有 `nuxi generate` 靜態輸出（`.output/public`，由 nginx 供應）。
- Produces: `manifest.webmanifest`、`sw.js`、`pwa-192x192.png`、`pwa-512x512.png`、`pwa-maskable-512x512.png`、`apple-touch-icon-180x180.png`。

- [ ] **Step 1: 安裝**

```bash
pnpm --filter @bill-alarm/web add -D @vite-pwa/nuxt @vite-pwa/assets-generator
```

- [ ] **Step 2: icon 來源 `apps/web/public/logo.svg`**

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="96" fill="#09090b"/>
  <rect x="88" y="152" width="336" height="224" rx="28" fill="none" stroke="#fafafa" stroke-width="28"/>
  <rect x="88" y="204" width="336" height="44" fill="#fafafa"/>
  <rect x="128" y="296" width="120" height="28" rx="14" fill="#fafafa"/>
  <circle cx="376" cy="310" r="34" fill="none" stroke="#f59e0b" stroke-width="20"/>
  <path d="M376 250 v-34 M376 370 v34 M316 310 h-34 M436 310 h34" stroke="#f59e0b" stroke-width="20" stroke-linecap="round"/>
</svg>
```

- [ ] **Step 3: `apps/web/pwa-assets.config.ts` + script**

```ts
import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config'

export default defineConfig({
  preset: minimal2023Preset,
  images: ['public/logo.svg'],
})
```

`apps/web/package.json` scripts 加：

```json
"generate-pwa-assets": "pwa-assets-generator"
```

執行：

```bash
pnpm --filter @bill-alarm/web run generate-pwa-assets
```

Expected: `apps/web/public/` 出現 `pwa-64x64.png`、`pwa-192x192.png`、`pwa-512x512.png`、`maskable-icon-512x512.png`、`apple-touch-icon-180x180.png`、`favicon.ico`。

- [ ] **Step 4: nuxt.config.ts 設定**

`modules` 加 `'@vite-pwa/nuxt'`；`app.head` 補 apple 相關；新增頂層 `pwa` 區塊：

```ts
export default defineNuxtConfig({
  modules: ['@unocss/nuxt', 'shadcn-nuxt', '@nuxt/eslint', '@vite-pwa/nuxt'],
  // …既有設定不動…
  app: {
    head: {
      title: 'Bill Alarm',
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
        { name: 'theme-color', content: '#09090b' },
        { name: 'apple-mobile-web-app-capable', content: 'yes' },
        { name: 'apple-mobile-web-app-status-bar-style', content: 'black-translucent' },
      ],
      link: [
        { rel: 'apple-touch-icon', href: '/apple-touch-icon-180x180.png' },
      ],
    },
  },
  pwa: {
    registerType: 'autoUpdate',
    manifest: {
      name: 'Bill Alarm',
      short_name: 'Bill Alarm',
      description: '信用卡帳單追蹤與繳費提醒',
      lang: 'zh-TW',
      display: 'standalone',
      start_url: '/',
      theme_color: '#09090b',
      background_color: '#09090b',
      icons: [
        { src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
        { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png' },
        { src: '/maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    },
    workbox: {
      globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
      // SPA 導覽離線 fallback；API 絕不可被 SW 攔走（帳務資料不可吃舊快取）
      navigateFallback: '/200.html',
      navigateFallbackDenylist: [/^\/api\//],
    },
  },
})
```

- [ ] **Step 5: 建置驗證**

```bash
pnpm --filter @bill-alarm/web generate
ls apps/web/.output/public/sw.js apps/web/.output/public/manifest.webmanifest
```

Expected: 兩檔皆存在；`manifest.webmanifest` 內含三個 icon 路徑。（nginx `root` 直接供應 `.output/public`，SW scope 為 `/`，不需改 nginx.conf。）

- [ ] **Step 6: dev 手動驗證**

`pnpm dev:web` → Chrome DevTools → Application → Manifest 顯示名稱與 icon、Service Workers 顯示已註冊（dev 模式 vite-pwa 用 dev-sw）。

- [ ] **Step 7: Commit**

```bash
git add apps/web/package.json apps/web/public/ apps/web/pwa-assets.config.ts apps/web/nuxt.config.ts pnpm-lock.yaml
git commit -m "feat(web): installable PWA with manifest, icons and offline app shell"
```

---

### Task 10: 文件、收尾與整體驗證

**Files:**
- Modify: `README.md`（認證章節 + 忘記密碼救援）
- Modify: `.claude/CLAUDE.md`（「No authentication」慣例已失效）

- [ ] **Step 1: README 加認證章節**

在 README 適當位置（部署章節後）加：

```markdown
## 認證

單一使用者帳密登入。首次啟動造訪任一頁面會導向 `/setup` 建立帳號密碼，
session 有效 30 天（活躍使用自動續期）。

### 忘記密碼

進入容器刪除密碼設定後，重新造訪網站會回到 `/setup`：

    docker compose exec bill-alarm node -e "
      const db = require('better-sqlite3')('/app/data/bill-alarm.db');
      db.prepare(\"DELETE FROM settings WHERE key IN ('auth_username','auth_password_hash')\").run();
      db.prepare('DELETE FROM sessions').run();
    "
```

- [ ] **Step 2: `.claude/CLAUDE.md` 更新慣例**

`## Conventions` 裡的 `- No authentication — single-user homelab app` 改為：

```markdown
- Single-user auth: username/password (scrypt) + 30-day rolling cookie session; whitelist in `routes/auth.ts` `authGuard`
```

- [ ] **Step 3: 整體驗證**

```bash
pnpm --filter @bill-alarm/server test   # 全部通過
pnpm lint                                # 無新錯誤
pnpm --filter @bill-alarm/web generate   # 建置成功
pnpm --filter @bill-alarm/server build   # tsup 成功
```

- [ ] **Step 4: 手動端到端（dev）**

1. 觸發一次掃描（設定頁）→ 掃描紀錄顯示舊信「此信件已建立過帳單」跳過，無新重複帳單。
2. 登入/登出/鎖定流程如 Task 8 Step 8。
3. 手機（同網段連 dev 或部署後）：Safari 分享 → 加入主畫面 → 開啟為全螢幕 standalone → 登入 → 關閉重開仍保持登入。

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs: auth section with password reset procedure"
```

（`.claude/CLAUDE.md` 已被 gitignore，不需 commit。）

---

## 部署切換（實作完成後，使用者自行操作）

1. Release 新版（`pnpm release`）→ 拉新 image 部署；`prisma migrate deploy` 自動套用 sessions migration。
2. 首次造訪 `https://bill.ysya.me`（仍在 CF Access 後）→ `/setup` 設定帳密。
3. 手機安裝 PWA、確認登入正常。
4. Cloudflare Zero Trust 移除 bill.ysya.me 的 Access application（保留 Tunnel），建議加 `/api/auth/login` rate-limit 規則。
5. 觀察數日掃描紀錄無重複後，於 UI 刪除兩筆既有重複：中信 `2026-06`（id 前綴 `019e5146-f94a`）、滙豐 `2026-04` 假逾期（id 前綴 `019df614`）。
