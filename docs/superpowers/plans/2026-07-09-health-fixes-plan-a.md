# Health Fixes Plan A（Phase 1–5：CI、shared 基礎、日期根治、解析鏈、排程）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落實 `docs/superpowers/specs/2026-07-09-health-report-fixes-design.md` 的 Phase 1–5：建立 CI 護欄、shared 日期/格式/掃描型別基礎、`dueDate` 改為 `YYYY-MM-DD` 字串（含資料轉換與 cascade）、解析鏈統一並移除 generic、timeOfDay 與逾期通知重做。

**Architecture:** monorepo（pnpm + turbo）。Hono server（`apps/server`）+ Nuxt 4 SPA（`apps/web`）+ `packages/shared`。DB 為 Prisma 7 + better-sqlite3 adapter（driver adapter 模式）。測試：vitest，DB 測試經 `setupTestDb()`（`prisma db push` 到暫存 SQLite 檔）。

**Tech Stack:** TypeScript、Hono 4、Prisma 7（SQLite）、zod 4、node-cron 4、vitest 4、ESLint 9 flat config。

## Global Constraints

- 所有既有 API URL 與回應欄位不變，除 spec 明列項目（本 plan 內：`dueDate` 值格式改為 `YYYY-MM-DD` 字串）。
- UI 與錯誤訊息文字用繁體中文；程式碼、註解、commit 用英文。
- Commit 用 conventional commits，訊息結尾加：`Claude-Session: https://claude.ai/code/session_01SSny4tRPZBGcNyo5mp8FxA`
- 每個 task 結束時：`pnpm --filter @bill-alarm/server test` 全綠 + `pnpm --filter @bill-alarm/server exec tsc --noEmit` 無錯，才能 commit。
- 分支：`refactor/health-report-fixes`（已存在，直接在上面工作）。不要 push。
- 套件管理一律 `pnpm`；在 repo root 執行除非另有註明。
- `packages/shared` 的檔案被 server 與 web 直接以 TS 原始碼引用（`exports` 指向 `.ts`），新增檔案必須同步加進 `packages/shared/package.json` 的 `exports`。

---

### Task 1: Server ESLint flat config + lint scripts

**Files:**
- Create: `apps/server/eslint.config.mjs`
- Modify: `apps/server/package.json`（devDeps + `lint` script）
- Modify: `apps/web/package.json`（補 `lint` script——目前 turbo lint 沒有任何 package 有 lint script，web 只有 eslint 設定檔）

**Interfaces:**
- Produces: `pnpm -r lint` 可在 root 執行且 exit 0（Task 2 的 CI 依賴這點）。

- [ ] **Step 1: 安裝依賴**

```bash
pnpm --filter @bill-alarm/server add -D eslint typescript-eslint @stylistic/eslint-plugin
```

- [ ] **Step 2: 建立 `apps/server/eslint.config.mjs`**

```js
import tseslint from 'typescript-eslint'
import stylistic from '@stylistic/eslint-plugin'

export default tseslint.config(
  { ignores: ['dist/**', 'generated/**', 'node_modules/**'] },
  ...tseslint.configs.recommended,
  {
    plugins: { '@stylistic': stylistic },
    rules: {
      '@stylistic/semi': ['error', 'never'],
      '@stylistic/quotes': ['error', 'single', { avoidEscape: true }],
      '@stylistic/comma-dangle': ['error', 'always-multiline'],
      // 既有程式碼大量使用 (e as Error) 斷言與少數 any，先不打型別戰
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
)
```

- [ ] **Step 3: 加 lint scripts**

`apps/server/package.json` 的 `scripts` 加：

```json
"lint": "eslint src scripts"
```

`apps/web/package.json` 的 `scripts` 加（web 已有 `@nuxt/eslint` 產生的 `eslint.config.mjs`，`postinstall: nuxt prepare` 會先產生型別）：

```json
"lint": "eslint ."
```

- [ ] **Step 4: 跑 lint 並修到綠**

```bash
pnpm -r lint
```

預期：初次會有違規（多為 stylistic 的機械性項目）。先跑 `pnpm --filter @bill-alarm/server exec eslint src scripts --fix` 與 `pnpm --filter @bill-alarm/web exec eslint . --fix` 自動修，剩餘手動修到兩個 package 都 exit 0。修復僅限 lint 規則要求的語法調整，不改任何行為。若某條規則與既有慣例大面積衝突（>50 處），在該 package 的 config 關閉那條規則並在 commit message 註明，不要大改碼。

- [ ] **Step 5: 驗證測試未被弄壞**

```bash
pnpm --filter @bill-alarm/server test
```

預期：PASS（14 個測試檔全綠）。

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: add eslint flat config to server, lint scripts to server/web

Claude-Session: https://claude.ai/code/session_01SSny4tRPZBGcNyo5mp8FxA"
```

---

### Task 2: CI test workflow

**Files:**
- Create: `.github/workflows/test.yml`

**Interfaces:**
- Consumes: Task 1 的 `pnpm -r lint`。
- Produces: PR / push main 時自動跑測試與 lint。

- [ ] **Step 1: 建立 workflow**

```yaml
name: Test

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        # 版本取自 root package.json 的 packageManager 欄位

      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: pnpm

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Test
        run: pnpm -r test

      - name: Lint
        run: pnpm -r lint
```

- [ ] **Step 2: 本地等效驗證**

CI 無法本地執行，跑等效指令確認 workflow 內容不會紅：

```bash
pnpm install --frozen-lockfile && pnpm -r test && pnpm -r lint
```

預期：全部 exit 0。（`pnpm -r test` 目前只有 server 有 test script，其餘 package 自動跳過——Task 3 之後 shared 也會被涵蓋。）

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/test.yml
git commit -m "ci: run tests and lint on pr and main pushes

Claude-Session: https://claude.ai/code/session_01SSny4tRPZBGcNyo5mp8FxA"
```

---

### Task 3: `packages/shared/date.ts` + shared 測試環境

**Files:**
- Create: `packages/shared/date.ts`
- Create: `packages/shared/__tests__/date.test.ts`
- Modify: `packages/shared/package.json`（exports、vitest devDep、test script）

**Interfaces:**
- Produces（後續所有 task 依賴，簽名固定）：
  - `isValidYMD(s: string): boolean`
  - `todayYMD(now?: Date): string` — 以**本地時區**取今天（伺服器 TZ 之後固定為 Asia/Taipei，瀏覽器本來就是使用者時區）
  - `addDaysYMD(ymd: string, days: number): string`
  - `daysUntil(ymd: string, now?: Date): number`
  - `formatYMD(ymd: string): string` — `2026-07-10` → `2026/07/10`
  - `deriveBillingPeriod(dueYMD: string): string` — 純年月運算，**不可**經過 `Date#setMonth`
  - `ymdFromParts(yearStr: string, monthStr: string, dayStr: string): string | null` — 含 ROC 年（<200 → +1911）與真實日期驗證

- [ ] **Step 1: 寫失敗測試 `packages/shared/__tests__/date.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import {
  isValidYMD, todayYMD, addDaysYMD, daysUntil,
  formatYMD, deriveBillingPeriod, ymdFromParts,
} from '../date'

describe('isValidYMD', () => {
  it('accepts real dates, rejects malformed and impossible ones', () => {
    expect(isValidYMD('2026-07-10')).toBe(true)
    expect(isValidYMD('2026-02-29')).toBe(false) // 2026 not a leap year
    expect(isValidYMD('2024-02-29')).toBe(true)
    expect(isValidYMD('2026-13-01')).toBe(false)
    expect(isValidYMD('2026-7-1')).toBe(false)
    expect(isValidYMD('garbage')).toBe(false)
  })
})

describe('todayYMD', () => {
  it('formats the provided now in local time', () => {
    expect(todayYMD(new Date(2026, 6, 9, 23, 59))).toBe('2026-07-09')
  })
})

describe('addDaysYMD', () => {
  it('rolls over months and years', () => {
    expect(addDaysYMD('2026-07-31', 1)).toBe('2026-08-01')
    expect(addDaysYMD('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDaysYMD('2026-03-01', -1)).toBe('2026-02-28')
    expect(addDaysYMD('2026-07-10', 0)).toBe('2026-07-10')
  })
})

describe('daysUntil', () => {
  const now = new Date(2026, 6, 9, 15, 0) // local 2026-07-09
  it('counts calendar days regardless of time of day', () => {
    expect(daysUntil('2026-07-09', now)).toBe(0)
    expect(daysUntil('2026-07-10', now)).toBe(1)
    expect(daysUntil('2026-07-06', now)).toBe(-3)
    expect(daysUntil('2026-08-09', now)).toBe(31)
  })
})

describe('formatYMD', () => {
  it('renders slashes', () => {
    expect(formatYMD('2026-07-10')).toBe('2026/07/10')
  })
})

describe('deriveBillingPeriod', () => {
  it('is pure year-month arithmetic', () => {
    expect(deriveBillingPeriod('2026-07-10')).toBe('2026-06')
    expect(deriveBillingPeriod('2026-01-15')).toBe('2025-12')
  })
  it('does not overflow on month-end due dates (regression: report 2.2)', () => {
    expect(deriveBillingPeriod('2026-05-31')).toBe('2026-04')
    expect(deriveBillingPeriod('2026-03-31')).toBe('2026-02')
    expect(deriveBillingPeriod('2026-03-29')).toBe('2026-02')
  })
})

describe('ymdFromParts', () => {
  it('converts ROC years', () => {
    expect(ymdFromParts('115', '4', '3')).toBe('2026-04-03')
    expect(ymdFromParts('2026', '04', '03')).toBe('2026-04-03')
  })
  it('rejects impossible dates and out-of-range years', () => {
    expect(ymdFromParts('115', '2', '30')).toBeNull()
    expect(ymdFromParts('1990', '1', '1')).toBeNull()
    expect(ymdFromParts('abc', '1', '1')).toBeNull()
  })
})
```

- [ ] **Step 2: 設定 shared 測試環境並確認測試失敗**

```bash
pnpm --filter @bill-alarm/shared add -D vitest
```

`packages/shared/package.json` 加 script `"test": "vitest run"`，並在 `exports` 加 `"./date": "./date.ts"`。

```bash
pnpm --filter @bill-alarm/shared test
```

預期：FAIL（`Cannot find module '../date'`）。

- [ ] **Step 3: 實作 `packages/shared/date.ts`**

```ts
// All calendar-day logic in this repo goes through this module.
// A "YMD" is a 'YYYY-MM-DD' string; comparisons and sorting are plain
// string operations, which match date order lexicographically.

export function isValidYMD(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const [y, m, d] = s.split('-').map(Number)
  if (m < 1 || m > 12 || d < 1) return false
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return d <= daysInMonth
}

/** Today's calendar date in the runtime's local timezone. */
export function todayYMD(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

export function addDaysYMD(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + days))
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`
}

/** Whole calendar days from today (local) to ymd. Negative = overdue. */
export function daysUntil(ymd: string, now: Date = new Date()): number {
  const [y, m, d] = ymd.split('-').map(Number)
  const [ty, tm, td] = todayYMD(now).split('-').map(Number)
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(ty, tm - 1, td)) / 86_400_000)
}

export function formatYMD(ymd: string): string {
  return ymd.replaceAll('-', '/')
}

/** Statement period fallback: the month before the due date. Pure arithmetic —
 *  Date#setMonth would overflow on month-end days (29–31). */
export function deriveBillingPeriod(dueYMD: string): string {
  const [y, m] = dueYMD.split('-').map(Number)
  const prevYear = m === 1 ? y - 1 : y
  const prevMonth = m === 1 ? 12 : m - 1
  return `${prevYear}-${String(prevMonth).padStart(2, '0')}`
}

/** Build a YMD from parsed fragments, converting ROC years (<200 → +1911).
 *  Returns null for impossible dates or years outside 2020–2100. */
export function ymdFromParts(yearStr: string, monthStr: string, dayStr: string): string | null {
  let year = parseInt(yearStr, 10)
  const month = parseInt(monthStr, 10)
  const day = parseInt(dayStr, 10)
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null
  if (year < 200) year += 1911
  if (year < 2020 || year > 2100) return null
  const s = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  return isValidYMD(s) ? s : null
}
```

- [ ] **Step 4: 跑測試到綠**

```bash
pnpm --filter @bill-alarm/shared test
```

預期：PASS（7 個 describe 全過）。

- [ ] **Step 5: Commit**

```bash
git add packages/shared
git commit -m "feat(shared): date-only (YYYY-MM-DD) calendar helpers

Claude-Session: https://claude.ai/code/session_01SSny4tRPZBGcNyo5mp8FxA"
```

---

### Task 4: `packages/shared/format.ts`

**Files:**
- Create: `packages/shared/format.ts`
- Create: `packages/shared/__tests__/format.test.ts`
- Modify: `packages/shared/package.json`（exports 加 `"./format": "./format.ts"`）

**Interfaces:**
- Consumes: Task 3 的 `daysUntil`。
- Produces:
  - `formatAmount(amount: number): string` — `NT$ 1,234`
  - `type DaysRemainingTone = 'overdue' | 'today' | 'soon' | 'normal'`
  - `daysRemainingInfo(dueYMD: string, now?: Date): { days: number; text: string; tone: DaysRemainingTone }`

- [ ] **Step 1: 寫失敗測試 `packages/shared/__tests__/format.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { formatAmount, daysRemainingInfo } from '../format'

describe('formatAmount', () => {
  it('formats NTD with thousands separators', () => {
    expect(formatAmount(69988)).toBe('NT$ 69,988')
    expect(formatAmount(0)).toBe('NT$ 0')
    expect(formatAmount(-1200)).toBe('NT$ -1,200')
  })
})

describe('daysRemainingInfo', () => {
  const now = new Date(2026, 6, 9) // local 2026-07-09
  it('classifies overdue / today / soon / normal', () => {
    expect(daysRemainingInfo('2026-07-06', now)).toEqual({ days: -3, text: '已逾期 3 天', tone: 'overdue' })
    expect(daysRemainingInfo('2026-07-09', now)).toEqual({ days: 0, text: '今天到期', tone: 'today' })
    expect(daysRemainingInfo('2026-07-12', now)).toEqual({ days: 3, text: '剩 3 天', tone: 'soon' })
    expect(daysRemainingInfo('2026-07-20', now)).toEqual({ days: 11, text: '剩 11 天', tone: 'normal' })
  })
})
```

執行 `pnpm --filter @bill-alarm/shared test`，預期：FAIL（module not found）。

- [ ] **Step 2: 實作 `packages/shared/format.ts`**

```ts
import { daysUntil } from './date'

export function formatAmount(amount: number): string {
  return `NT$ ${amount.toLocaleString('zh-TW')}`
}

export type DaysRemainingTone = 'overdue' | 'today' | 'soon' | 'normal'

export function daysRemainingInfo(
  dueYMD: string,
  now: Date = new Date(),
): { days: number; text: string; tone: DaysRemainingTone } {
  const days = daysUntil(dueYMD, now)
  if (days < 0) return { days, text: `已逾期 ${Math.abs(days)} 天`, tone: 'overdue' }
  if (days === 0) return { days, text: '今天到期', tone: 'today' }
  if (days <= 3) return { days, text: `剩 ${days} 天`, tone: 'soon' }
  return { days, text: `剩 ${days} 天`, tone: 'normal' }
}
```

同時把 `"./format": "./format.ts"` 加進 `packages/shared/package.json` 的 `exports`。

- [ ] **Step 3: 跑測試到綠並 commit**

```bash
pnpm --filter @bill-alarm/shared test
git add packages/shared
git commit -m "feat(shared): amount and days-remaining formatting helpers

Claude-Session: https://claude.ai/code/session_01SSny4tRPZBGcNyo5mp8FxA"
```

（server/web 改用這些 helper 分別在 Task 6 與 Plan B Phase 9 進行，本 task 不動呼叫端。）

---

### Task 5: 掃描型別搬入 `packages/shared/scan.ts`

**Files:**
- Create: `packages/shared/scan.ts`
- Modify: `packages/shared/package.json`（exports 加 `"./scan": "./scan.ts"`）
- Modify: `apps/server/src/services/scan-events.ts`、`apps/server/src/services/email-parser.ts`、`apps/server/src/routes/system.ts`
- Modify: `apps/web/composables/useScanEvents.ts`、`apps/web/composables/useSettingsApi.ts`

**Interfaces:**
- Produces（單一事實來源；SSE wire format 本來就含 `userId`，web 端只是不讀它）：

```ts
// packages/shared/scan.ts —— 全文
export type ScanTrigger = 'manual' | 'cron'
export type ScanItemStatus = 'matched' | 'success' | 'error' | 'skipped'

export type ScanErrorStage =
  | 'email_search'
  | 'email_fetch'
  | 'pdf_password'
  | 'pdf_extract'
  | 'parse_failed'
  | 'sanity_check'
  | 'unexpected'
  | 'notification'

export interface ScanError {
  stage: ScanErrorStage
  reason: string
  bank?: string
  msgId?: string
}

export type ScanEvent =
  | { type: 'start'; userId: string; scanLogId: string; total: number; trigger: ScanTrigger }
  | {
      type: 'progress'
      userId: string
      scanLogId: string
      idx: number
      total: number
      bank?: string
      status: ScanItemStatus
      reason?: string
    }
  | {
      type: 'complete'
      userId: string
      scanLogId: string
      scanned: number
      newBills: number
      errorCount: number
    }

export interface ScanLogDTO {
  id: string
  trigger: ScanTrigger
  startedAt: string
  finishedAt: string | null
  scanned: number
  newBillsCount: number
  errorCount: number
  errors: ScanError[]
  fatalError: string | null
}
```

- [ ] **Step 1: 建立 `packages/shared/scan.ts`**（上方全文）並加 exports 項。

- [ ] **Step 2: server 端改 import**

- `services/scan-events.ts`：刪掉檔內的 `ScanEvent` 定義（第 3–28 行），改 `import type { ScanEvent } from '@bill-alarm/shared/scan'` 並 `export type { ScanEvent }`（`ScanSnapshot` 與 bus class 留在原檔）。
- `services/email-parser.ts`：刪掉 `ScanErrorStage`/`ScanError`/`ScanItemStatus` 定義（第 19–34、42 行），改 `import type { ScanError, ScanItemStatus } from '@bill-alarm/shared/scan'`，並保留 `export type { ScanError }`（`routes/system.ts` 與 `routes/scan` 拆分前仍從這裡 import——維持 re-export 讓呼叫端不用同時改）。
- `routes/system.ts` 不需改（經 re-export 取得）。

- [ ] **Step 3: web 端改 import**

- `composables/useScanEvents.ts`：刪掉檔內 `ScanEvent`/`ScanItemStatus` 定義（第 1–25 行），改 `import type { ScanEvent, ScanItemStatus, ScanTrigger } from '@bill-alarm/shared/scan'`；`ScanProgressState` 留在原檔。順手把第 39 行過時註解 `/api/system/scan-events` 改為 `/api/scan-events`。
- `composables/useSettingsApi.ts`：刪掉 `ScanErrorStage`/`ScanError`/`ScanLogDTO` 定義（第 3–30 行），改 `import type { ScanError, ScanLogDTO } from '@bill-alarm/shared/scan'` 並 re-export（`export type { ScanError, ScanLogDTO }`，因為 `ScanLogList.vue` 等元件可能從這裡 import——先 `grep -rn "from '~/composables/useSettingsApi'" apps/web` 確認使用者，把 type import 一併指向 shared 或沿用 re-export）。

- [ ] **Step 4: 驗證**

```bash
pnpm --filter @bill-alarm/server exec tsc --noEmit
pnpm --filter @bill-alarm/server test
pnpm -r lint
```

預期：全綠。web 無 tsc 任務，靠 lint + Plan B 的 build 驗證；此 task 是純型別搬移，不改任何 runtime 行為。

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(shared): single source of truth for scan event/error types

Claude-Session: https://claude.ai/code/session_01SSny4tRPZBGcNyo5mp8FxA"
```

---

### Task 6: dueDate → `YYYY-MM-DD` 字串（schema migration + 全 server 讀寫點）

> **原子性說明**：schema.prisma 一改，`setupTestDb()` 的 `db push` 與 Prisma 生成型別立即翻轉，所有讀寫點必須在同一個 commit 內完成才會綠。本 task 是本 plan 最大的一個，照 step 順序做，中途不 commit。

**Files:**
- Modify: `apps/server/prisma/schema.prisma`
- Create: `apps/server/prisma/migrations/<timestamp>_due_date_ymd_and_cascades/migration.sql`（由 `--create-only` 產生後手改）
- Modify: `packages/shared/types.ts`（`ParsedBill.dueDate: string`）
- Modify: `apps/server/src/parsers/utils.ts`、`template.ts`、`esun.ts`、`yuanta.ts`、`ctbc.ts`、`taishin.ts`、`sinopac.ts`、`ubot.ts`、`cathay.ts`、`hsbc.ts`、`generic.ts`
- Modify: `apps/server/src/services/llm-parser.ts`、`email-parser.ts`、`notification.ts`、`telegram.ts`
- Modify: `apps/server/src/routes/bills.ts`、`calendar-feed.ts`、`system.ts`
- Modify: `apps/web/pages/bills/[id].vue`（編輯表單改送 YMD 字串）
- Modify: 受影響的測試檔（以 `tsc --noEmit` 列舉）
- Test: `apps/server/src/services/__tests__/`（既有測試更新）

**Interfaces:**
- Consumes: Task 3 的 `date.ts` 全部函式。
- Produces: `Bill.dueDate` 在 DB、Prisma 型別、API 回應中一律為 `YYYY-MM-DD` 字串；`ParsedBill.dueDate: string`。後續 task（7–13）與 Plan B 都以此為前提。

- [ ] **Step 1: 探測既有 DateTime 儲存格式**

寫一次性腳本 `/private/tmp/claude-501/-Users-ysya-project-homelab-bill-alarm/*/scratchpad/probe-datetime.ts`（scratchpad 目錄，不進 repo）：

```ts
import { setupTestDb } from '/Users/ysya/project/homelab/bill-alarm/apps/server/src/services/__tests__/helpers/test-db.js'

const url = setupTestDb()
const { default: prisma } = await import('/Users/ysya/project/homelab/bill-alarm/apps/server/src/prisma.js')
const u = await prisma.user.create({ data: { username: 'probe', passwordHash: 'x' } })
const b = await prisma.bank.create({ data: { name: 'p', emailSenderPattern: 'x', emailSubjectPattern: 'y', userId: u.id } })
await prisma.bill.create({ data: { bankId: b.id, billingPeriod: '2026-06', amount: 1, dueDate: new Date('2026-07-10T00:00:00Z') } })
const Database = (await import('better-sqlite3')).default
const raw = new Database(url.replace('file:', ''))
console.log(raw.prepare('SELECT dueDate, typeof(dueDate) AS t FROM bills').all())
```

```bash
cd apps/server && pnpm exec tsx <scratchpad>/probe-datetime.ts
```

預期輸出二擇一，決定 Step 4 的轉換 SQL：
- `t: 'text'`（ISO 字串，如 `2026-07-10 00:00:00` 或含 `T`/`Z`）→ 用 **SQL-A**
- `t: 'integer'` 或 `'real'`（epoch 毫秒）→ 用 **SQL-B**

- [ ] **Step 2: 修改 `schema.prisma`**

對 `Bill` model：

```prisma
model Bill {
  id               String            @id @default(uuid(7))
  bankId           String
  bank             Bank              @relation(fields: [bankId], references: [id], onDelete: Cascade)
  billingPeriod    String
  amount           Int
  minimumPayment   Int?
  dueDate          String            // calendar date, 'YYYY-MM-DD'
  status           String            @default("pending")
  parseSource      String?           // 'template' | 'hardcoded' | 'llm' ('generic' exists on legacy rows)
  paidAt           DateTime?
  sourceEmailId    String?
  rawEmailSnippet  String?
  pdfPath          String?
  createdAt        DateTime          @default(now())
  updatedAt        DateTime          @updatedAt
  notifications    NotificationLog[]

  @@unique([bankId, billingPeriod])
  @@index([status, dueDate])
  @@index([bankId])
  @@map("bills")
}
```

（相對現狀的變化：`dueDate` 型別、**刪除 `calendarEventId`**、bank 關聯加 `onDelete: Cascade`、兩個 `@@index`。）

對 `NotificationLog`：

```prisma
  bill         Bill              @relation(fields: [billId], references: [id], onDelete: Cascade)
  rule         NotificationRule? @relation(fields: [ruleId], references: [id], onDelete: SetNull)
```

對 `Session` 加：

```prisma
  @@index([expiresAt])
```

- [ ] **Step 3: 產生 migration（不套用）**

```bash
cd apps/server && pnpm exec prisma migrate dev --create-only --name due_date_ymd_and_cascades
```

預期：`prisma/migrations/<ts>_due_date_ymd_and_cascades/migration.sql` 生成，內容是 SQLite 的 table rebuild（`CREATE TABLE "new_bills" …; INSERT INTO "new_bills" (…) SELECT … FROM "bills";`）。

- [ ] **Step 4: 手改 migration 的資料轉換**

在生成的 `INSERT INTO "new_bills" … SELECT` 中，把 `"dueDate"` 這個來源欄位換成轉換運算式（**+8 小時 = Asia/Taipei**，spec §1 已驗證對全部歷史寫入路徑正確）：

- **SQL-A（TEXT 儲存）**：`date(datetime("dueDate", '+8 hours'))`
- **SQL-B（epoch 毫秒）**：`date("dueDate" / 1000, 'unixepoch', '+8 hours')`

其他欄位的搬移與 `calendarEventId` 的移除維持 Prisma 生成的原樣。在檔案頂端加一行 SQL 註解說明轉換理由：

```sql
-- dueDate: DateTime -> 'YYYY-MM-DD' TEXT. Historic rows were written as UTC
-- midnight (parser/LLM) or Taipei-midnight-in-UTC (frontend edits); shifting
-- +8h before taking the date yields the intended Taipei calendar date for all.
```

- [ ] **Step 4b: 實證驗證轉換運算式（spec §10 要求）**

在 scratchpad 用 sqlite3 對兩種歷史寫入路徑驗證同一運算式（以 Step 1 探測到的格式為準；下例為 TEXT 版，epoch 版把值換成 `1783987200000` 與 `1783958400000`）：

```bash
sqlite3 :memory: <<'SQL'
CREATE TABLE probe (dueDate TEXT);
INSERT INTO probe VALUES ('2026-07-10T00:00:00.000Z');  -- parser/LLM 路徑（UTC 午夜）
INSERT INTO probe VALUES ('2026-07-09T16:00:00.000Z');  -- 前端編輯路徑（台北午夜的 UTC）
SELECT dueDate, date(datetime(dueDate, '+8 hours')) FROM probe;
SQL
```

預期：兩列的轉換結果**都是** `2026-07-10`。若 `datetime()` 對實際儲存格式回 NULL（格式不被 SQLite 接受），調整運算式（如先 `replace(dueDate, 'T', ' ')`）直到兩列都正確，再把最終版寫回 migration.sql。

- [ ] **Step 5: 套用 migration 並重生 client**

```bash
cd apps/server && pnpm exec prisma migrate dev
```

預期：migration applied、`prisma generate` 自動執行。此刻 `tsc --noEmit` 會大量報錯——正常，往下修。

- [ ] **Step 6: shared 與 parser 層改為字串**

`packages/shared/types.ts`：

```ts
export interface ParsedBill {
  amount: number
  minimumPayment?: number
  dueDate: string // 'YYYY-MM-DD'
  billingPeriod: string
}
```

`apps/server/src/parsers/utils.ts`：

- 刪除 `deriveBillingPeriod`（Date 版）與 `parseDate`（Date 版）。
- `parseYear`、`parseAmount`、`firstMatch`、`extractBillingPeriod` 保留。
- 新增轉接（讓九個 parser 檔的呼叫點改動最小）：

```ts
import { ymdFromParts } from '@bill-alarm/shared/date'
export { deriveBillingPeriod } from '@bill-alarm/shared/date'

/** Parse y/m/d fragments (ROC or AD) into a 'YYYY-MM-DD' string, or null. */
export const parseDate = ymdFromParts
```

九個 bank parser 檔與 `generic.ts`：`extractDueDate` 回傳型別 `Date | null` → `string | null`（實作不變，`parseDate` 現在回字串）；`deriveBillingPeriod(dueDate)` 呼叫不變（參數已是字串）。

`apps/server/src/parsers/template.ts`：

```ts
// toDate 改名 toYMD，回傳字串
function toYMD(type: FieldType, result: RuleResult): string | null {
  const m = result.match
  if (type === 'rocDate' || type === 'adDate') return parseDate(m[1], m[2], m[3])
  return null
}
```

`parseWithTemplateDetailed` 內 `dueDate` 區塊型別 `Date | null` → `string | null`、錯誤訊息不變；組裝 `bill` 時 `billingPeriod: billingPeriod ?? deriveBillingPeriod(dueDate)` 不變。

- [ ] **Step 7: `llm-parser.ts`**

`parseBillResponse` 改為（取代第 220–251 行）：

```ts
import { deriveBillingPeriod, isValidYMD } from '@bill-alarm/shared/date'

export function parseBillResponse(raw: string): ParsedBill | null {
  if (!raw) return null
  try {
    const data = JSON.parse(raw)
    if (data.amount == null || typeof data.dueDate !== 'string') return null

    const dueDate = data.dueDate.trim()
    if (!isValidYMD(dueDate)) return null

    const billingPeriod =
      typeof data.billingPeriod === 'string' && /^\d{4}-\d{2}$/.test(data.billingPeriod)
        ? data.billingPeriod
        : deriveBillingPeriod(dueDate)

    return {
      amount: Math.round(data.amount),
      minimumPayment: data.minimumPayment != null ? Math.round(data.minimumPayment) : undefined,
      dueDate,
      billingPeriod,
    }
  } catch {
    return null
  }
}
```

（原本檔內的手寫「前一月」推導刪除——這正是報告 2.2 指出的重複實作，統一走 shared。）

- [ ] **Step 8: `email-parser.ts`**

- `sanityCheck`（第 55–67 行）改用 shared：

```ts
import { daysUntil } from '@bill-alarm/shared/date'

function sanityCheck(parsed: ParsedBill): string | null {
  if (!Number.isFinite(parsed.amount)) return '金額非數字'
  if (Math.abs(parsed.amount) > 500_000) return `金額超出合理範圍 (${parsed.amount})`
  if (parsed.minimumPayment != null && parsed.minimumPayment > Math.abs(parsed.amount)) {
    return '最低應繳超過本期應繳總額'
  }
  const days = daysUntil(parsed.dueDate)
  if (days < -90) return '繳款截止日在過去 90 天以前'
  if (days > 90) return '繳款截止日超過未來 90 天'
  return null
}
```

- `duplicateBillExists(bankId, amount, dueDate)` 參數 `dueDate: Date` → `dueDate: string`（Prisma where 不變，等值比較現在是字串）。
- `prisma.bill.create` 的 `dueDate: parsed.dueDate` 不變（型別已是字串）。
- log 行 `dueDate: parsed.dueDate`（原本是 Date）現在自然輸出字串，不需改。

- [ ] **Step 9: `notification.ts` 與 `telegram.ts`**

`notification.ts` — `processReminderRules` 的日期窗（第 50–67 行）改字串相等（timeOfDay 邏輯在 Task 10 才動，此處只換日期型別）：

```ts
import { todayYMD, addDaysYMD } from '@bill-alarm/shared/date'

// 迴圈內：
const targetYMD = addDaysYMD(todayYMD(), rule.daysBefore)
const bills = await prisma.bill.findMany({
  where: {
    status: BillStatus.PENDING,
    bank: { userId: rule.userId },
    dueDate: targetYMD,
  },
  include: { bank: true },
})
```

`processOverdueBills`（第 102–129 行）的查詢條件改：

```ts
const overdueBills = await prisma.bill.findMany({
  where: {
    status: BillStatus.PENDING,
    dueDate: { lt: todayYMD() },
  },
  include: { bank: { include: { user: { select: { deletedAt: true } } } } },
})
```

`telegram.ts` — 刪掉檔內 `formatAmount`/`formatDate`/`daysUntil`（第 106–120 行），改：

```ts
import { formatAmount } from '@bill-alarm/shared/format'
import { daysUntil, formatYMD } from '@bill-alarm/shared/date'
```

三個 send 函式中 `formatDate(bill.dueDate)` → `formatYMD(bill.dueDate)`、`daysUntil(bill.dueDate)` 直接可用（參數已是字串）。

- [ ] **Step 10: routes**

`bills.ts`：

- `updateBillSchema.dueDate`：`z.string().datetime()` → `z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'dueDate 須為 YYYY-MM-DD 格式')`。
- PATCH handler 刪掉 `if (data.dueDate) updateData.dueDate = new Date(data.dueDate)`（字串直存）。
- `/summary`（第 29–52 行）：

```ts
import { todayYMD } from '@bill-alarm/shared/date'

const today = todayYMD()
const upcomingBills = pending
  .filter((b) => b.dueDate >= today)
  .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
```

（`currentMonth` 的計算保留原樣或改 `todayYMD().slice(0, 7)`，取後者。）

`calendar-feed.ts` — `dateToArray` 改收字串（第 14–16 行）：

```ts
function dateToArray(ymd: string): DateArray {
  const [y, m, d] = ymd.split('-').map(Number)
  return [y, m, d]
}
```

檔內 `formatAmount` 刪除、改 import shared 的（Step 9 已建立慣例）。

`system.ts` — 三處 `extracted.bill.dueDate.toISOString().split('T')[0]`（`/email/message/:id/parse`、`/parser/test-pdf`、`/parser/test-text`）與 `/parser/test-template`、`/parser/bootstrap/:billId` 的同型式全部改為直接輸出 `…dueDate`（已是 YMD 字串）。

- [ ] **Step 11: 用 tsc 掃殘餘並修測試**

```bash
cd apps/server && pnpm exec tsc --noEmit
```

逐一修掉剩餘錯誤。**機械轉換規則**：測試或程式中所有作為 `dueDate` 的 `new Date('…')` / `new Date(y, m, d)` 字面值 → `'YYYY-MM-DD'` 字串；比較斷言同步改字串。範例（`email-parser-dedup.test.ts` 型式）：

```ts
// before
dueDate: new Date('2026-07-10')
// after
dueDate: '2026-07-10'
```

```bash
pnpm --filter @bill-alarm/server test && pnpm --filter @bill-alarm/shared test
```

預期：全綠。

- [ ] **Step 12: web 端唯一必要修改**

`apps/web/pages/bills/[id].vue`：

- `startEdit`（第 446 行）：`dueDate: new Date(bill.value.dueDate).toISOString().split('T')[0]` → `dueDate: bill.value.dueDate`（API 已回 YMD）。
- `handleSaveEdit`（第 463 行）：`dueDate: new Date(editForm.value.dueDate + 'T00:00:00').toISOString()` → `dueDate: editForm.value.dueDate`。

（`formatDate`/`daysUntil` 等顯示 helper 收到 `'YYYY-MM-DD'` 經 `new Date()` 在台北時區仍顯示正確，全面換用 shared 是 Plan B Phase 9 的事，這裡不動。）

- [ ] **Step 13: 手動煙霧測試**

```bash
pnpm dev:server & pnpm dev:web
```

登入 → 儀表板數字正常 → 帳單詳情 → 編輯 dueDate 存檔 → 顯示與 badge 正確。完成後停掉 dev servers。

- [ ] **Step 14: Commit**

```bash
git add -A
git commit -m "refactor!: store bill due dates as YYYY-MM-DD calendar strings

Migration shifts historic timestamps +8h (Asia/Taipei) before taking the
date — correct for every historic write path (UTC-midnight parser/LLM rows
and Taipei-midnight frontend edits). Adds bank/bill cascade FKs, status and
bankId indexes, drops dead calendarEventId column.

Claude-Session: https://claude.ai/code/session_01SSny4tRPZBGcNyo5mp8FxA"
```

---

### Task 7: Cascade 帶來的路由簡化 + banks 前置檢查

**Files:**
- Modify: `apps/server/src/routes/bills.ts`（DELETE handler）
- Modify: `apps/server/src/routes/users.ts`（permanent delete）
- Modify: `apps/server/src/routes/banks.ts`（DELETE handler）
- Test: `apps/server/src/routes/__tests__/banks.test.ts`（新建）

**Interfaces:**
- Consumes: Task 6 的 cascade 外鍵。

- [ ] **Step 1: 寫失敗測試 `apps/server/src/routes/__tests__/banks.test.ts`**

參考 `users.test.ts` 的既有結構（`setupTestDb()` → import app → 以 `app.request()` 打 API、先建 admin + session cookie；沿用該檔的登入 helper 寫法）：

```ts
// 測試三件事：
// 1. DELETE /api/banks/:id 對「有帳單的自訂銀行」回 400 與訊息「此銀行尚有 N 筆帳單」
// 2. DELETE /api/banks/:id 對「無帳單的自訂銀行」回 200，且 bank 消失
// 3. DELETE /api/bills/:id 刪除後，該帳單的 notificationLog 因 cascade 一併消失
```

測試中直接用 prisma 建 bank / bill（`dueDate: '2026-07-10'`）/ notificationLog 資料列。執行：

```bash
pnpm --filter @bill-alarm/server test -- banks
```

預期：FAIL（400 檢查尚未實作；cascade 斷言先過不了因為手動 deleteMany 仍在也可能過——以 400 檢查為主要紅燈）。

- [ ] **Step 2: 實作**

`banks.ts` DELETE（第 102–108 行）加前置檢查：

```ts
app.delete('/:id', async (c) => {
  const bank = await prisma.bank.findFirst({ where: { id: c.req.param('id'), userId: getAuthUser(c).id } })
  if (!bank) return c.json({ error: 'Not found' }, 404)
  if (bank.isBuiltin) return c.json({ error: '無法刪除內建銀行，請改為停用' }, 400)
  const billCount = await prisma.bill.count({ where: { bankId: bank.id } })
  if (billCount > 0) return c.json({ error: `此銀行尚有 ${billCount} 筆帳單，請先刪除帳單` }, 400)
  await prisma.bank.delete({ where: { id: bank.id } })
  return c.json({ success: true })
})
```

`bills.ts` DELETE：刪掉 `await prisma.notificationLog.deleteMany({ where: { billId: bill.id } })`（cascade 接手）。

`users.ts` permanent delete：`$transaction([...])` 整段換成：

```ts
// user delete cascades: banks -> bills -> notification logs,
// plus bankAccounts / notificationRules / scanLogs / sessions.
await prisma.user.delete({ where: { id: user.id } })
```

- [ ] **Step 3: 跑測試到綠並 commit**

```bash
pnpm --filter @bill-alarm/server test
git add -A
git commit -m "refactor(server): lean on cascade FKs; friendly 400 for bank-with-bills delete

Claude-Session: https://claude.ai/code/session_01SSny4tRPZBGcNyo5mp8FxA"
```

---

### Task 8: 統一解析鏈 `bill-parser.ts`，移除 generic

**Files:**
- Create: `apps/server/src/services/bill-parser.ts`
- Create: `apps/server/src/services/__tests__/bill-parser.test.ts`
- Delete: `apps/server/src/parsers/generic.ts`、`apps/server/src/services/bill-extractor.ts`
- Modify: `apps/server/src/parsers/registry.ts`（刪 `getParser`/`parseText`）、`apps/server/src/parsers/__tests__/registry.test.ts`
- Modify: `apps/server/src/services/email-parser.ts`（內聯鏈換成呼叫）
- Modify: `apps/server/src/routes/system.ts`（debug 路由改走統一鏈）
- Modify: `packages/shared/types.ts`（寫入側 `ParseSource`）

**Interfaces:**
- Consumes: `parseWithTemplate`、`getHardcodedParser`、`parseBillWithLLM`、`getLlmProvider`。
- Produces:

```ts
// services/bill-parser.ts
export type ParseSource = 'template' | 'hardcoded' | 'llm'
export interface ParseAttempt { source: ParseSource; error: string }
export interface ParseOutcome {
  bill: ParsedBill | null
  source: ParseSource | null
  attempts: ParseAttempt[]
}
export interface ParseBankInfo {
  code: string | null
  name: string
  parserConfig: string | null
}
export function parseBill(text: string, bank: ParseBankInfo, opts: { allowLlm: boolean }): Promise<ParseOutcome>
```

- [ ] **Step 1: 寫失敗測試 `bill-parser.test.ts`**

用 `vi.mock` 掛掉 `./llm-parser.js`（mock `parseBillWithLLM` 與 `getLlmProvider`），不打真 LLM：

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/services/llm-parser.js', () => ({
  LlmProvider: { None: 'none', Gemini: 'gemini', OpenAI: 'openai', Ollama: 'ollama' },
  getLlmProvider: vi.fn(async () => 'none'),
  parseBillWithLLM: vi.fn(async () => null),
}))

import { parseBill } from '@/services/bill-parser.js'
import { getLlmProvider, parseBillWithLLM } from '@/services/llm-parser.js'

// 玉山 hardcoded parser 能解的最小文字（取自 esun.ts 註解的表格格式）
const ESUN_TEXT = [
  '115年02月 信用卡帳單',
  '本期應繳總金額 本期最低應繳金額',
  'TWD 0 69,988 6,999',
  '繳款截止日：115/04/13',
].join('\n')

describe('parseBill chain', () => {
  beforeEach(() => vi.clearAllMocks())

  it('template config wins when it parses', async () => {
    const config = JSON.stringify({
      amount: { keyword: '本期應繳總金額', type: 'amount', nth: 2 },
      dueDate: { keyword: '繳款截止日', type: 'rocDate', nth: 1 },
    })
    const r = await parseBill(ESUN_TEXT, { code: 'esun', name: '玉山', parserConfig: config }, { allowLlm: false })
    expect(r.source).toBe('template')
    expect(r.bill?.dueDate).toBe('2026-04-13')
  })

  it('falls through invalid template JSON to hardcoded, recording the attempt', async () => {
    const r = await parseBill(ESUN_TEXT, { code: 'esun', name: '玉山', parserConfig: '{not json' }, { allowLlm: false })
    expect(r.source).toBe('hardcoded')
    expect(r.attempts).toEqual([{ source: 'template', error: expect.stringContaining('JSON') }])
  })

  it('unknown bank + llm disallowed -> null with attempts, llm never called', async () => {
    const r = await parseBill('隨便的文字', { code: null, name: 'X', parserConfig: null }, { allowLlm: false })
    expect(r.bill).toBeNull()
    expect(r.source).toBeNull()
    expect(parseBillWithLLM).not.toHaveBeenCalled()
  })

  it('llm allowed + provider configured -> llm result', async () => {
    vi.mocked(getLlmProvider).mockResolvedValue('gemini' as never)
    vi.mocked(parseBillWithLLM).mockResolvedValue({
      amount: 100, dueDate: '2026-08-01', billingPeriod: '2026-07',
    })
    const r = await parseBill('unparseable', { code: null, name: 'X', parserConfig: null }, { allowLlm: true })
    expect(r.source).toBe('llm')
    expect(r.bill?.amount).toBe(100)
  })

  it('llm allowed but provider none -> attempts record it, no throw', async () => {
    const r = await parseBill('unparseable', { code: null, name: 'X', parserConfig: null }, { allowLlm: true })
    expect(r.bill).toBeNull()
    expect(r.attempts.at(-1)).toEqual({ source: 'llm', error: expect.stringContaining('LLM 未設定') })
  })
})
```

```bash
pnpm --filter @bill-alarm/server test -- bill-parser
```

預期：FAIL（module 不存在）。

- [ ] **Step 2: 實作 `services/bill-parser.ts`**

```ts
import type { ParsedBill } from '@bill-alarm/shared/types'
import type { TemplateParserConfig } from '@bill-alarm/shared/template-parser'
import { parseWithTemplate } from '@/parsers/template.js'
import { getHardcodedParser } from '@/parsers/registry.js'
import { parseBillWithLLM, getLlmProvider, LlmProvider } from './llm-parser.js'

export type ParseSource = 'template' | 'hardcoded' | 'llm'

export interface ParseAttempt {
  source: ParseSource
  error: string
}

export interface ParseOutcome {
  bill: ParsedBill | null
  source: ParseSource | null
  attempts: ParseAttempt[]
}

export interface ParseBankInfo {
  code: string | null
  name: string
  parserConfig: string | null
}

/**
 * The single bill-parsing chain: template -> hardcoded -> LLM.
 * Every caller (real scan and Parser Lab debug routes) goes through here,
 * so tested behaviour is deployed behaviour.
 */
export async function parseBill(
  text: string,
  bank: ParseBankInfo,
  opts: { allowLlm: boolean },
): Promise<ParseOutcome> {
  const attempts: ParseAttempt[] = []

  if (bank.parserConfig) {
    try {
      const config = JSON.parse(bank.parserConfig) as TemplateParserConfig
      const bill = parseWithTemplate(text, config)
      if (bill) return { bill, source: 'template', attempts }
      attempts.push({ source: 'template', error: '模板規則無法匹配欄位' })
    } catch (e) {
      attempts.push({ source: 'template', error: `模板設定 JSON 無效: ${(e as Error).message}` })
    }
  }

  const hardcoded = getHardcodedParser(bank.code)
  if (hardcoded) {
    const bill = hardcoded.parse(text)
    if (bill) return { bill, source: 'hardcoded', attempts }
    attempts.push({ source: 'hardcoded', error: '內建規則無法匹配欄位' })
  }

  if (opts.allowLlm) {
    if ((await getLlmProvider()) === LlmProvider.None) {
      attempts.push({ source: 'llm', error: 'LLM 未設定，無法解析帳單。請至設定 → LLM 啟用' })
      return { bill: null, source: null, attempts }
    }
    try {
      const bill = await parseBillWithLLM(text, bank.name)
      if (bill) return { bill, source: 'llm', attempts }
      attempts.push({ source: 'llm', error: 'LLM 回傳結果無法解析為有效帳單' })
    } catch (e) {
      attempts.push({ source: 'llm', error: `LLM 解析失敗：${(e as Error).message}` })
    }
  }

  return { bill: null, source: null, attempts }
}
```

跑 Step 1 測試到綠。

- [ ] **Step 3: 移除 generic 與舊鏈**

- 刪檔：`src/parsers/generic.ts`、`src/services/bill-extractor.ts`。
- `registry.ts`：刪 `getParser`、`parseText` 與 `genericParser` import；保留 `getHardcodedParser`、`listParserCodes`。
- `packages/shared/types.ts`：`BillDTO.parseSource` 聯集**保留** `'generic'` 並註記 `// 'generic': legacy rows only`（讀取側容忍舊資料）。
- `apps/web/pages/bills/[id].vue` 的 `parseSourceLabel/Icon/Class`：保留 `'generic'` 分支，加註解 `// legacy value from pre-0.4 scans`。

- [ ] **Step 4: 改接 `email-parser.ts`**

把第 196–250 行的內聯 template/hardcoded/LLM 鏈整段換成：

```ts
import { parseBill } from './bill-parser.js'

// …迴圈內，取代原本三段式解析：
const outcome = await parseBill(pdfText, bank, { allowLlm: true })
for (const attempt of outcome.attempts) {
  logger.debug({ bank: bank.name, attempt }, 'Parse attempt failed')
}
if (!outcome.bill) {
  const reason = outcome.attempts.at(-1)?.error ?? '無法解析帳單'
  result.errors.push({ stage: 'parse_failed', bank: bank.name, msgId, reason })
  progressStatus = 'error'
  progressReason = reason
  continue
}
const parsed = outcome.bill
const source = outcome.source
```

（`bank` 直接符合 `ParseBankInfo` 形狀——Prisma Bank row 有 `code`/`name`/`parserConfig`。）

- [ ] **Step 5: 改接 `system.ts` debug 路由**

先確認前端消費者，避免破壞 Parser Lab UI：

```bash
grep -rn "parser/test-pdf\|parser/test-text\|regexResult" apps/web --include='*.vue' --include='*.ts' | grep -v node_modules
```

規則：**回應只加欄位、不刪欄位**。`/parser/test-pdf` 與 `/parser/test-text`：

- 原本 `extractBillFromText(pdfText, bankCode)` 改為：

```ts
const bank = { code: bankCode ?? null, name: bankCode ?? 'unknown', parserConfig: null as string | null }
const outcome = await parseBill(pdfText, bank, { allowLlm: useLlm })
```

- 回應維持 `regexResult` 鍵名（來源為 template/hardcoded 時填入，內容同現制，`dueDate` 直接是 YMD 字串）；`llmResult` 在 `outcome.source === 'llm'` 時填 `outcome.bill`；新增 `attempts: outcome.attempts`。原本「`useLlm && !extracted` 才叫 LLM」的語意由 `allowLlm` 涵蓋。
- `/parser/list` 回應的 `fallback: 'generic'` 改為 `fallback: 'llm'`。

- [ ] **Step 6: 更新 `parsers/__tests__/registry.test.ts`**

刪掉 `parseText`/generic 相關測試；保留/改寫為 `getHardcodedParser('esun')` 回非 null、`getHardcodedParser('unknown')` 回 null、`listParserCodes()` 含八個 code。

- [ ] **Step 7: 全綠 + commit**

```bash
pnpm --filter @bill-alarm/server exec tsc --noEmit && pnpm --filter @bill-alarm/server test && pnpm -r lint
git add -A
git commit -m "refactor(server): unify parse chain (template->hardcoded->LLM), drop generic parser

Claude-Session: https://claude.ai/code/session_01SSny4tRPZBGcNyo5mp8FxA"
```

---

### Task 9: `parserConfig` 寫入驗證（shared zod schema）

**Files:**
- Modify: `packages/shared/template-parser.ts`（加 zod schema；刪 `TEMPLATE_PRESETS`——死碼，五家銀行皆有 hardcoded parser）
- Modify: `packages/shared/package.json`（dependencies 加 `zod`）
- Modify: `apps/server/src/routes/banks.ts`（PATCH 驗證）
- Modify: `apps/server/src/routes/system.ts`（`/parser/test-template` 改用 shared schema，刪重複定義）
- Test: `apps/server/src/routes/__tests__/banks.test.ts`（擴充）

**Interfaces:**
- Produces: `templateParserConfigSchema`（zod）＋既有 `TemplateParserConfig` 型別不變。

- [ ] **Step 1: 失敗測試**

`banks.test.ts` 加兩個 case：PATCH `parserConfig` 為 `'{not json'` → 400；為合法 config JSON → 200 且存入。跑測試預期 FAIL（現在任意字串都 200）。

- [ ] **Step 2: shared schema**

```bash
pnpm --filter @bill-alarm/shared add zod
```

`packages/shared/template-parser.ts` 加（並刪除 `TEMPLATE_PRESETS` 區塊）：

```ts
import { z } from 'zod'

export const fieldRuleSchema = z.object({
  keyword: z.string().min(1),
  type: z.enum(['amount', 'rocDate', 'adDate', 'yearMonth']),
  nth: z.number().int().positive().optional(),
})

export const templateParserConfigSchema = z.object({
  amount: fieldRuleSchema,
  dueDate: fieldRuleSchema,
  minimumPayment: fieldRuleSchema.optional(),
  billingPeriod: fieldRuleSchema.optional(),
})
```

- [ ] **Step 3: 接上 banks PATCH**

`banks.ts` PATCH handler 開頭（zValidator 之後）加：

```ts
import { templateParserConfigSchema } from '@bill-alarm/shared/template-parser'

if (typeof data.parserConfig === 'string') {
  let parsed: unknown
  try {
    parsed = JSON.parse(data.parserConfig)
  } catch {
    return c.json({ error: 'parserConfig 不是合法 JSON' }, 400)
  }
  const check = templateParserConfigSchema.safeParse(parsed)
  if (!check.success) return c.json({ error: `parserConfig 格式錯誤：${check.error.issues[0]?.message}` }, 400)
}
```

`system.ts` 的 `/parser/test-template`：刪掉檔內 `fieldRuleSchema` 定義，`config` 欄位改 `templateParserConfigSchema`，`as TemplateParserConfig` 斷言移除（schema 推導即為該型別）。

- [ ] **Step 4: 全綠 + commit**

```bash
pnpm --filter @bill-alarm/server test && pnpm -r lint
git add -A
git commit -m "feat(server): validate parserConfig on write via shared zod schema

Claude-Session: https://claude.ai/code/session_01SSny4tRPZBGcNyo5mp8FxA"
```

---

### Task 10: timeOfDay 生效（15 分鐘 tick + 時間窗）

**Files:**
- Modify: `apps/server/src/services/notification.ts`（`processReminderRules`）
- Modify: `apps/server/src/services/scheduler.ts`（cron 頻率）
- Test: `apps/server/src/services/__tests__/reminder-timing.test.ts`（新建）

**Interfaces:**
- Produces: `processReminderRules(now?: Date): Promise<void>` — `now` 可注入供測試。
- 語意（spec §2）：tick 內對每條 active 規則，當 `now >= 今天的 rule.timeOfDay` 且該 (rule, bill) 今天無成功紀錄時發送。停機自癒、當天稍晚建立的帳單仍會提醒。

- [ ] **Step 1: 失敗測試 `reminder-timing.test.ts`**

結構仿 `notification-owner.test.ts`（`setupTestDb()`、`vi.mock('@/services/telegram.js', …)` 攔 `sendBillReminder` 回 `{ ok: true }`）。資料：user + bank + rule（`daysBefore: 3`、`timeOfDay: '09:00'`、channels `['telegram']`）+ bill（`dueDate: addDaysYMD(todayYMD(), 3)`、PENDING）。

```ts
// case 1: 08:50 tick 不發
await processReminderRules(new Date(2026, 6, 9, 8, 50))
expect(sendBillReminder).not.toHaveBeenCalled()

// case 2: 09:10 tick 發一次
await processReminderRules(new Date(2026, 6, 9, 9, 10))
expect(sendBillReminder).toHaveBeenCalledTimes(1)

// case 3: 同日 09:25 tick 不重發（NotificationLog 去重）
await processReminderRules(new Date(2026, 6, 9, 9, 25))
expect(sendBillReminder).toHaveBeenCalledTimes(1)

// case 4: 發送失敗（mock 回 { ok: false, error: 'x' }）後的下一個 tick 會重試
```

注意：case 內 `new Date(2026, 6, 9, …)` 的日期部分必須與資料列的 `todayYMD()` 一致——直接以 `const now = new Date()` 為基底、用 `setHours` 造各時刻，避免跨日 flake：

```ts
function at(h: number, m: number): Date {
  const d = new Date()
  d.setHours(h, m, 0, 0)
  return d
}
```

（若真實現在時間在 09:00 前後邊界，`todayYMD(now)` 與資料建立用同一個 `now` 基底即可穩定。）

跑 `pnpm --filter @bill-alarm/server test -- reminder-timing`，預期 FAIL（`processReminderRules` 不吃參數且無時間窗）。

- [ ] **Step 2: 實作 `processReminderRules(now = new Date())`**

取代現有函式（保留 autoDebit 跳過與 per-channel try/catch 結構）：

```ts
import { todayYMD, addDaysYMD } from '@bill-alarm/shared/date'

/** Runs on a 15-minute tick. A rule fires once per day, at the first tick
 *  at/after its timeOfDay — so a missed tick (deploy, downtime) self-heals
 *  on the next one, and bills scanned in after the hour still remind today. */
export async function processReminderRules(now: Date = new Date()): Promise<void> {
  const rules = await prisma.notificationRule.findMany({
    where: { isActive: true, user: { deletedAt: null } },
  })
  const today = todayYMD(now)
  const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  const todayStart = new Date(now)
  todayStart.setHours(0, 0, 0, 0)

  for (const rule of rules) {
    if (hhmm < rule.timeOfDay) continue // not yet time today (string compare works for HH:mm)

    const bills = await prisma.bill.findMany({
      where: {
        status: BillStatus.PENDING,
        bank: { userId: rule.userId },
        dueDate: addDaysYMD(today, rule.daysBefore),
      },
      include: { bank: true },
    })

    const channels: string[] = JSON.parse(rule.channels)

    for (const bill of bills) {
      if (bill.bank.autoDebit) continue

      const alreadySent = await prisma.notificationLog.findFirst({
        where: { billId: bill.id, ruleId: rule.id, sentAt: { gte: todayStart }, success: true },
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

- [ ] **Step 3: scheduler cron 改頻率**

`scheduler.ts` 第 83 行：`cron.schedule('5 0 * * *', …)` → `cron.schedule('*/15 * * * *', …)`（timezone 選項在 Task 12 統一加）。callback 內容不變（`processReminderRules()` + `processOverdueBills()`——後者在 Task 11 重做，此刻沿用）。log 訊息 `'Processing reminder rules...'` 改為 `logger.debug`（每 15 分鐘一次，info 太吵）。

- [ ] **Step 4: 全綠 + commit**

```bash
pnpm --filter @bill-alarm/server test
git add -A
git commit -m "feat(server): honor NotificationRule.timeOfDay via 15-minute reminder tick

Claude-Session: https://claude.ai/code/session_01SSny4tRPZBGcNyo5mp8FxA"
```

---

### Task 11: 逾期處理拆分（標記即時、通知 09:00 後一次）

**Files:**
- Modify: `apps/server/src/services/notification.ts`（`processOverdueBills`、新常數）
- Test: `apps/server/src/services/__tests__/overdue.test.ts`（新建）

**Interfaces:**
- Produces: `processOverdueBills(now?: Date): Promise<void>`；`export const OVERDUE_WARNING_MESSAGE = '逾期警告'`（去重依據，禁止字面值散落）。
- 語意（spec §2）：每 tick 批次標記 `PENDING && dueDate < today` → OVERDUE；通知只在 `now.getHours() >= 9` 且該帳單無成功 `OVERDUE_WARNING_MESSAGE` 紀錄時發，一生一次。

- [ ] **Step 1: 失敗測試 `overdue.test.ts`**

同 Task 10 的 mock 手法（攔 `sendOverdueWarning`）。資料：bill `dueDate: addDaysYMD(todayYMD(), -1)`、PENDING。

```ts
// case 1: 00:10 tick — 標記為 OVERDUE，但不發通知
await processOverdueBills(at(0, 10))
expect((await prisma.bill.findUniqueOrThrow({ where: { id: bill.id } })).status).toBe('overdue')
expect(sendOverdueWarning).not.toHaveBeenCalled()

// case 2: 09:10 tick — 發一次
await processOverdueBills(at(9, 10))
expect(sendOverdueWarning).toHaveBeenCalledTimes(1)

// case 3: 再一個 tick — 不重發（log 去重）
await processOverdueBills(at(9, 25))
expect(sendOverdueWarning).toHaveBeenCalledTimes(1)

// case 4: 停用帳號的 owner 不收通知（status 照標）——沿用現有語意
```

預期 FAIL。

- [ ] **Step 2: 實作**

```ts
export const OVERDUE_WARNING_MESSAGE = '逾期警告'
const OVERDUE_NOTIFY_HOUR = 9 // don't page people at midnight

export async function processOverdueBills(now: Date = new Date()): Promise<void> {
  const today = todayYMD(now)

  // Mark on every tick so the dashboard is accurate within 15 minutes of midnight.
  const marked = await prisma.bill.updateMany({
    where: { status: BillStatus.PENDING, dueDate: { lt: today } },
    data: { status: BillStatus.OVERDUE },
  })
  if (marked.count > 0) logger.warn({ count: marked.count }, 'Bills marked overdue')

  if (now.getHours() < OVERDUE_NOTIFY_HOUR) return

  // Warn exactly once per bill, at the first tick at/after 09:00.
  const unnotified = await prisma.bill.findMany({
    where: {
      status: BillStatus.OVERDUE,
      notifications: { none: { message: OVERDUE_WARNING_MESSAGE, success: true } },
    },
    include: { bank: { include: { user: { select: { deletedAt: true } } } } },
  })

  for (const bill of unnotified) {
    if (bill.bank.user?.deletedAt) continue // deactivated owner: status is fact, noise is not
    const r = await sendOverdueWarning(bill, bill.bank)
    await logNotification(bill.id, null, 'telegram', OVERDUE_WARNING_MESSAGE, r.ok, r.error)
  }
}
```

`logNotification` 呼叫處原本的 `'逾期警告'` 字面值改用常數。

**注意**：舊資料的歷史逾期通知 message 也是 `'逾期警告'` 字串，`notifications: { none: … }` 條件天然涵蓋，不會對舊逾期帳單重發。

- [ ] **Step 3: 全綠 + commit**

```bash
pnpm --filter @bill-alarm/server test
git add -A
git commit -m "feat(server): split overdue marking (every tick) from warning (once, after 09:00)

Claude-Session: https://claude.ai/code/session_01SSny4tRPZBGcNyo5mp8FxA"
```

---

### Task 12: sanity 警告透傳到 Telegram + TZ 固定

**Files:**
- Modify: `apps/server/src/services/email-parser.ts`（`ScanResult.newBills` 元素加 `warning`）
- Modify: `apps/server/src/services/notification.ts`（`processNewBill` 簽名）
- Modify: `apps/server/src/services/telegram.ts`（`sendNewBillAlert` 附警告行）
- Modify: `apps/server/src/services/scheduler.ts`、`apps/server/src/routes/system.ts`（呼叫端傳遞 + cron timezone）
- Modify: `Dockerfile`（`ENV TZ=Asia/Taipei`）
- Test: `apps/server/src/services/__tests__/telegram.test.ts`（擴充）

**Interfaces:**
- Produces:
  - `ScanResult.newBills: Array<{ bill: Bill; bank: Bank; warning?: string }>`
  - `processNewBill(bill: Bill, bank: Bank, warning?: string): Promise<void>`
  - `sendNewBillAlert(bill: Bill, bank: Bank, warning?: string): Promise<SendOutcome>`

- [ ] **Step 1: 失敗測試**

`telegram.test.ts` 加 case（該檔已有攔 fetch / getSetting 的手法，沿用）：`sendNewBillAlert(bill, bank, '金額超出合理範圍 (600000)')` 組出的訊息文字含 `⚠️ 解析結果異常（金額超出合理範圍 (600000)），請核對後再繳費`。預期 FAIL。

- [ ] **Step 2: 實作**

`telegram.ts` `sendNewBillAlert` 第三參數 `warning?: string`，在 LLM 提示行區塊之前加：

```ts
if (warning) {
  lines.push('')
  lines.push(`⚠️ 解析結果異常（${warning}），請核對後再繳費。`)
}
```

`email-parser.ts`：sanity check 區塊（現為記錯誤但續建帳單）把 `sanityErr` 存到區域變數，`result.newBills.push({ bill, bank, warning: sanityErr ?? undefined })`。

`notification.ts` `processNewBill(bill, bank, warning?)` → `sendNewBillAlert(bill, bank, warning)`。

兩個呼叫端（`scheduler.ts` 第 58 行、`routes/system.ts` 第 40 行）：`for (const { bill, bank, warning } of result.newBills)` → `processNewBill(bill, bank, warning)`。

- [ ] **Step 3: TZ 固定**

`Dockerfile` 第 43 行 `ENV NODE_ENV=production` 旁加：

```dockerfile
ENV TZ=Asia/Taipei
```

`scheduler.ts` 兩個 `cron.schedule(expr, fn)` 都加第三參數：

```ts
{ timezone: 'Asia/Taipei' }
```

（node-cron 4 的 options 物件。若 tsc 對選項名報錯，查 `node_modules/node-cron` 的型別定義用正確欄位名——v4 曾將 `scheduled` 等選項改名，timezone 欄位名以型別為準。）

- [ ] **Step 4: 全綠 + commit**

```bash
pnpm --filter @bill-alarm/server exec tsc --noEmit && pnpm --filter @bill-alarm/server test && pnpm -r lint
git add -A
git commit -m "feat(server): surface sanity-check warnings in Telegram alerts; pin Asia/Taipei

Claude-Session: https://claude.ai/code/session_01SSny4tRPZBGcNyo5mp8FxA"
```

---

### Task 13: Hardcoded parser 合成 fixture 測試

**Files:**
- Create: `apps/server/src/parsers/__tests__/fixtures.ts`（去識別化合成文字）
- Create: `apps/server/src/parsers/__tests__/bank-parsers.test.ts`

**Interfaces:**
- Consumes: 各 parser 的 `parse(text)`。

- [ ] **Step 1: 建 fixtures**

依各 parser 檔頭註解記載的格式特徵，為 `esun`、`yuanta`、`ctbc`、`taishin`、`sinopac`、`ubot`、`cathay`、`hsbc_tw` 各造一段最小合成文字（金額用假數字、日期用民國 115 年、不含任何真實個資）。**做法**：逐檔閱讀該 parser 的 regex 與註解，構造能命中第一優先 pattern 的文字。例（esun，對照其註解「TWD 0 69,988 69,988 6,999」）：

```ts
export const FIXTURES: Record<string, { text: string; expected: { amount: number; dueDate: string; minimumPayment?: number; billingPeriod?: string } }> = {
  esun: {
    text: [
      '115年02月 信用卡帳單',
      '本期應繳總金額 本期最低應繳金額',
      'TWD 0 69,988 69,988 6,999',
      '69,988 元',
      '115/04/13',
    ].join('\n'),
    expected: { amount: 69988, dueDate: '2026-04-13', minimumPayment: 6999, billingPeriod: '2026-02' },
  },
  // …其餘七家同法，expected 以「實際跑出的合理結果」為準：
  // 先寫 text，跑 parser 印出結果，人工核對日期/金額語意正確後定 expected（characterization test）。
}
```

- [ ] **Step 2: 測試檔**

```ts
import { describe, it, expect } from 'vitest'
import { getHardcodedParser, listParserCodes } from '../registry.js'
import { FIXTURES } from './fixtures.js'

describe('hardcoded bank parsers', () => {
  for (const code of listParserCodes()) {
    it(`${code} parses its fixture`, () => {
      const fixture = FIXTURES[code]
      expect(fixture, `missing fixture for ${code} — add one to fixtures.ts`).toBeDefined()
      const bill = getHardcodedParser(code)!.parse(fixture.text)
      expect(bill).not.toBeNull()
      expect(bill).toMatchObject(fixture.expected)
    })
  }
})
```

（用 `listParserCodes()` 驅動：未來新增銀行沒補 fixture 會直接紅。）

- [ ] **Step 3: 跑到綠**

對跑不綠的 fixture：先確認是 fixture 文字沒命中 regex（調 fixture），只有在確定 parser 本身有 bug 時才修 parser 並在 commit message 說明。預期本 task 是 characterization，不改 parser 行為。

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/parsers/__tests__
git commit -m "test(server): synthetic fixtures for all hardcoded bank parsers

Claude-Session: https://claude.ai/code/session_01SSny4tRPZBGcNyo5mp8FxA"
```

---

## Plan A 完成定義

- [ ] `pnpm -r test`、`pnpm -r lint`、`pnpm --filter @bill-alarm/server exec tsc --noEmit` 全綠。
- [ ] 手動煙霧（`pnpm dev`）：登入 → 儀表板 → 帳單編輯（日期存 YMD）→ 手動掃描 → 通知規則 CRUD。
- [ ] 向使用者回報，接著寫 Plan B（Phase 6–10：路由/強化、email 抽象、secrets、前端收斂、文件），把本 plan 執行中的發現（DateTime 儲存格式、node-cron options 欄位名、Parser Lab 前端消費者清單）帶進去。
