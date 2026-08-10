# 通知與授權 UX 重整 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 依 `docs/superpowers/specs/2026-08-11-notification-settings-ux-design.md`，把「多條具名通知規則」換成單一偏好面板、設定頁按使用者心智重分區、儀表板加三步設定進度卡、Telegram 綁定改自動輪詢、通知失敗浮出。

**Architecture:** 後端先行（schema → prefs service → notification service → routes），前端隨後（types/composable → 偏好卡 → 送達卡 → 資料來源拆分 → 進度卡）。偏好列允許不存在，所有讀取端共用同一組預設值 fallback。

**Tech Stack:** Prisma + SQLite、Hono + zod、Nuxt 4 + shadcn-vue、vitest。

## Global Constraints

- 預設偏好：`remindDays [3,1]`、`remindTime "09:00"`、`notifyNewBill true`、`notifyOverdue true`（單一常數 `DEFAULT_PREFS`，除它之外不得出現第二份預設值）。
- `remindDays` 驗證：0–30 整數、去重、最多 6 個；回應一律由大到小排序（`normalizeRemindDays`）。
- 到期提醒 log `message` 格式固定為 `到期提醒 D-${d}`；去重 key＝billId＋當日＋message＋success。
- 綁定 confirm 端點語意不變：200 ok／404 not_seen／410 expired。
- 文案為 zh-TW；程式碼與 commit message 為英文（conventional commits）。
- 測試指令：`pnpm --filter @bill-alarm/server test`；typecheck：根目錄 `pnpm typecheck`；web lint：`pnpm --filter @bill-alarm/web lint`。
- 單一檔案跑測試：`pnpm --filter @bill-alarm/server exec vitest run src/<path>`。

---

### Task 1: Schema 與 migration（含資料轉換）

**Files:**
- Modify: `apps/server/prisma/schema.prisma`
- Create: `apps/server/prisma/migrations/<timestamp>_notification_preferences/migration.sql`（由 `--create-only` 產生後手動加轉換段）

**Interfaces:**
- Produces: Prisma model `NotificationPreference`（fields: `id`, `userId` unique, `remindDays: String`, `remindTime: String`, `notifyNewBill: Boolean`, `notifyOverdue: Boolean`, timestamps）；`NotificationRule` model 消失；`NotificationLog` 無 `ruleId`。

- [ ] **Step 1: 修改 schema.prisma**

刪掉整個 `model NotificationRule`；`NotificationLog` 刪 `ruleId`/`rule` 兩行；`User` 的 `notificationRules NotificationRule[]` 改為 `notificationPreference NotificationPreference?`；新增：

```prisma
model NotificationPreference {
  id            String   @id @default(uuid(7))
  userId        String   @unique
  user          User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  remindDays    String   @default("[3,1]")  // JSON int array; [] = due-date reminders off
  remindTime    String   @default("09:00")  // HH:mm
  notifyNewBill Boolean  @default(true)
  notifyOverdue Boolean  @default(true)
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  @@map("notification_preferences")
}
```

- [ ] **Step 2: 建 scratch DB 驗證環境（migration 的「失敗測試」）**

```bash
SCRATCH=/private/tmp/claude-501/-Users-ysya-project-sideproj-bill-alarm/ba1ec9df-e18c-466a-a148-04ddf3ca1aa6/scratchpad/mig-scratch.db
rm -f "$SCRATCH"
cd apps/server
DATABASE_URL="file:$SCRATCH" pnpm exec prisma migrate deploy   # 只套用既有 9 個 migration
sqlite3 "$SCRATCH" <<'SQL'
INSERT INTO users (id,username,passwordHash,role,createdAt,updatedAt) VALUES
 ('u1','active-rules','x','member',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
 ('u2','all-inactive','x','member',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
 ('u3','no-rules','x','member',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
INSERT INTO notification_rules (id,name,daysBefore,timeOfDay,channels,isActive,userId,createdAt,updatedAt) VALUES
 ('r1','a',3,'09:00','["telegram"]',1,'u1',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
 ('r2','b',7,'08:30','["telegram"]',1,'u1',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
 ('r3','c',3,'10:00','["telegram"]',1,'u1',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
 ('r4','d',5,'12:00','["telegram"]',0,'u2',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
SQL
```

- [ ] **Step 3: 產生 migration 並插入轉換 SQL**

```bash
pnpm exec prisma migrate dev --create-only --name notification_preferences
```

編輯產生的 `migration.sql`：保留 Prisma 生成的 DDL，但把下面轉換段插在「CreateTable notification_preferences 之後、DropTable notification_rules 之前」：

```sql
-- Data conversion: materialize prefs only for users who have at least one rule.
-- remindDays = DISTINCT active daysBefore (order irrelevant — readers normalize),
-- remindTime = earliest active timeOfDay; users with only inactive rules get '[]'.
INSERT INTO "notification_preferences" ("id","userId","remindDays","remindTime","createdAt","updatedAt")
SELECT
    lower(hex(randomblob(16))),
    u."id",
    COALESCE((
        SELECT '[' || group_concat(DISTINCT r."daysBefore") || ']'
        FROM "notification_rules" r
        WHERE r."userId" = u."id" AND r."isActive" = 1
    ), '[]'),
    COALESCE((
        SELECT MIN(r."timeOfDay") FROM "notification_rules" r
        WHERE r."userId" = u."id" AND r."isActive" = 1
    ), '09:00'),
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "users" u
WHERE EXISTS (SELECT 1 FROM "notification_rules" r WHERE r."userId" = u."id");
```

- [ ] **Step 4: 在 scratch DB 套用並驗證三情境**

```bash
DATABASE_URL="file:$SCRATCH" pnpm exec prisma migrate deploy
sqlite3 "$SCRATCH" "SELECT userId, remindDays, remindTime FROM notification_preferences ORDER BY userId;"
```

Expected：`u1|[3,7] 或 [7,3]|08:30`、`u2|[]|09:00`、u3 無資料列；且 `notification_logs` 表已無 `ruleId` 欄（`sqlite3 "$SCRATCH" '.schema notification_logs'` 確認）、`notification_rules` 表不存在。

- [ ] **Step 5: 套用到 dev DB 並 regenerate client**

```bash
pnpm exec prisma migrate dev
pnpm exec prisma generate
```

- [ ] **Step 6: Commit**

```bash
git add apps/server/prisma
git commit -m "feat(server): notification preferences table replaces rules (with data migration)"
```

（此時 server 原始碼還在引用 `notificationRule`，typecheck 會紅——Task 2–4 內修復；本 commit 只含 prisma 目錄，不破壞可回溯性。）

---

### Task 2: prefs service（預設值 fallback 的單一出處）

**Files:**
- Create: `apps/server/src/services/notification-prefs.ts`
- Test: `apps/server/src/services/__tests__/notification-prefs.test.ts`

**Interfaces:**
- Produces:
  - `DEFAULT_PREFS: EffectivePrefs`
  - `interface EffectivePrefs { remindDays: number[]; remindTime: string; notifyNewBill: boolean; notifyOverdue: boolean }`
  - `normalizeRemindDays(days: number[]): number[]`（去重＋由大到小）
  - `getEffectivePrefs(userId: string): Promise<EffectivePrefs>`（無資料列＝回傳預設值，不建列）

- [ ] **Step 1: 寫失敗測試**

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { setupTestDb } from './helpers/test-db.js'

setupTestDb()
process.env.LOG_LEVEL = 'silent'

const { default: prisma } = await import('@/prisma.js')
const { getEffectivePrefs, normalizeRemindDays, DEFAULT_PREFS } = await import('../notification-prefs.js')

beforeEach(async () => {
  await prisma.notificationPreference.deleteMany()
  await prisma.user.deleteMany()
})

async function seedUser(username = 'alice') {
  return prisma.user.create({ data: { username, passwordHash: 'x:y', role: 'member' } })
}

describe('normalizeRemindDays', () => {
  it('dedupes and sorts descending', () => {
    expect(normalizeRemindDays([1, 3, 3, 7])).toEqual([7, 3, 1])
  })
})

describe('getEffectivePrefs', () => {
  it('falls back to DEFAULT_PREFS when no row exists', async () => {
    const user = await seedUser()
    const prefs = await getEffectivePrefs(user.id)
    expect(prefs).toEqual(DEFAULT_PREFS)
  })

  it('parses and normalizes a stored row', async () => {
    const user = await seedUser()
    await prisma.notificationPreference.create({
      data: { userId: user.id, remindDays: '[1,7,3]', remindTime: '21:30', notifyNewBill: false, notifyOverdue: true },
    })
    const prefs = await getEffectivePrefs(user.id)
    expect(prefs).toEqual({ remindDays: [7, 3, 1], remindTime: '21:30', notifyNewBill: false, notifyOverdue: true })
  })

  it('empty remindDays means reminders off, not defaults', async () => {
    const user = await seedUser()
    await prisma.notificationPreference.create({ data: { userId: user.id, remindDays: '[]' } })
    const prefs = await getEffectivePrefs(user.id)
    expect(prefs.remindDays).toEqual([])
  })
})
```

- [ ] **Step 2: 跑測試確認失敗**（module not found）
- [ ] **Step 3: 實作**

```ts
import prisma from '@/prisma.js'

export interface EffectivePrefs {
  remindDays: number[]
  remindTime: string
  notifyNewBill: boolean
  notifyOverdue: boolean
}

/** The ONLY place defaults live. Absent row ⇒ these values, for every reader. */
export const DEFAULT_PREFS: EffectivePrefs = {
  remindDays: [3, 1],
  remindTime: '09:00',
  notifyNewBill: true,
  notifyOverdue: true,
}

/** Canonical order for storage and responses: dedupe + sort descending. */
export function normalizeRemindDays(days: number[]): number[] {
  return [...new Set(days)].sort((a, b) => b - a)
}

/** Read a user's prefs; absent row = shared defaults (no row is created here). */
export async function getEffectivePrefs(userId: string): Promise<EffectivePrefs> {
  const row = await prisma.notificationPreference.findUnique({ where: { userId } })
  if (!row) return { ...DEFAULT_PREFS, remindDays: [...DEFAULT_PREFS.remindDays] }
  return {
    remindDays: normalizeRemindDays(JSON.parse(row.remindDays)),
    remindTime: row.remindTime,
    notifyNewBill: row.notifyNewBill,
    notifyOverdue: row.notifyOverdue,
  }
}
```

- [ ] **Step 4: 跑測試確認通過**
- [ ] **Step 5: Commit** `feat(server): effective notification prefs with shared defaults`

---

### Task 3: notification service 改用偏好（含排程器接線）

**Files:**
- Modify: `apps/server/src/services/notification.ts`（`processReminderRules` → `processReminders`；`logNotification` 去掉 `ruleId` 參數；`processNewBill`/`processOverdueBills` 加偏好 gate）
- Modify: `apps/server/src/services/scheduler.ts`（import/呼叫改 `processReminders`）
- Test: 改寫 `apps/server/src/services/__tests__/reminder-timing.test.ts`、`notification-owner.test.ts`、`overdue.test.ts`

**Interfaces:**
- Consumes: `getEffectivePrefs`（Task 2）
- Produces: `processReminders(now?: Date): Promise<void>`；`processNewBill`/`processOverdueBills` 簽名不變。

- [ ] **Step 1: 改寫 reminder-timing.test.ts（先紅）**

seed 改用偏好；既有 8 個案例語意全部保留（時間閘門、當日去重、失敗重試、自癒、晚到帳單、autoDebit 略過），「inactive rule」案例改成「`remindDays: '[]'` 不發送」，並新增「無偏好列走預設值（09:00 前不發、後發）」與「多天數 [7,3] 各自命中」兩案例：

```ts
async function seedUserBank(remindDays: string | null, remindTime = '09:00') {
  const user = await prisma.user.create({
    data: { username: 'alice', passwordHash: 'x:y', role: 'member', telegramChatId: '111' },
  })
  if (remindDays !== null) {
    await prisma.notificationPreference.create({
      data: { userId: user.id, remindDays, remindTime },
    })
  }
  const bank = await prisma.bank.create({
    data: { name: 'alice-bank', emailSenderPattern: 'x@x', emailSubjectPattern: 'b', userId: user.id },
  })
  return { user, bank }
}
```

新增案例（其餘案例把 `seedRule(3,'09:00')` 換 `seedUserBank('[3]','09:00')`、`processReminderRules` 換 `processReminders`）：

```ts
it('no prefs row: defaults apply (sends for D-3 at 09:10, not at 08:50)', async () => {
  const { bank } = await seedUserBank(null)   // no row → DEFAULT_PREFS [3,1] 09:00
  await seedBill(bank.id, 3)
  await processReminders(at(8, 50))
  expect(sendBillReminder).not.toHaveBeenCalled()
  await processReminders(at(9, 10))
  expect(sendBillReminder).toHaveBeenCalledTimes(1)
})

it('remindDays [] disables due reminders entirely', async () => {
  const { bank } = await seedUserBank('[]')
  await seedBill(bank.id, 3)
  await processReminders(at(9, 10))
  expect(sendBillReminder).not.toHaveBeenCalled()
})

it('multiple days: D-7 and D-3 bills both remind, distinct dedup keys', async () => {
  const { bank } = await seedUserBank('[7,3]')
  await seedBill(bank.id, 7)
  await seedBill2(bank.id, 3)   // 同 bank 第二張帳單，billingPeriod 需不同
  await processReminders(at(9, 10))
  expect(sendBillReminder).toHaveBeenCalledTimes(2)
  const messages = (await prisma.notificationLog.findMany()).map(l => l.message).sort()
  expect(messages).toEqual(['到期提醒 D-3', '到期提醒 D-7'])
})
```

（`seedBill2` 同 `seedBill` 但 `billingPeriod: '2026-08'`，避開 `@@unique([bankId, billingPeriod])`。）

- [ ] **Step 2: 跑 reminder-timing 確認紅**
- [ ] **Step 3: 改寫 notification.ts**

```ts
import prisma from '@/prisma.js'
import { logger } from '@/index.js'
import { sendNewBillAlert, sendBillReminder, sendOverdueWarning } from './telegram.js'
import { getEffectivePrefs } from './notification-prefs.js'
import type { Bill, Bank } from '../../generated/prisma/client.js'
import { BillStatus } from '@bill-alarm/shared/types'
import { todayYMD, addDaysYMD } from '@bill-alarm/shared/date'

async function logNotification(
  billId: string,
  channel: string,
  message: string,
  success: boolean,
  errorMessage?: string,
) {
  await prisma.notificationLog.create({
    data: { billId, channel, message, success, errorMessage },
  })
}

export async function processNewBill(bill: Bill, bank: Bank, warning?: string): Promise<void> {
  logger.info({ bank: bank.name, amount: bill.amount }, 'Processing new bill notifications')

  if (bill.status === BillStatus.NO_PAYMENT) { /* 原樣保留 */ }
  if (bank.autoDebit) { /* 原樣保留 */ }
  // owner deactivated 檢查原樣保留

  const prefs = await getEffectivePrefs(bank.userId)
  if (!prefs.notifyNewBill) {
    logger.info({ bank: bank.name }, 'Owner disabled new-bill notifications — skipping')
    return
  }

  const r = await sendNewBillAlert(bill, bank, warning)
  await logNotification(bill.id, 'telegram', '新帳單通知', r.ok, r.error)
  logger.info({ bank: bank.name, ok: r.ok }, 'Telegram notification sent')
}

/** Runs on a 15-minute tick.（原註解語意保留）Per-user prefs replace rules. */
export async function processReminders(now: Date = new Date()): Promise<void> {
  const users = await prisma.user.findMany({ where: { deletedAt: null }, select: { id: true } })
  const today = todayYMD(now)
  const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  const todayStart = new Date(now)
  todayStart.setHours(0, 0, 0, 0)

  for (const user of users) {
    const prefs = await getEffectivePrefs(user.id)
    if (prefs.remindDays.length === 0) continue
    if (hhmm < prefs.remindTime) continue // string compare works for HH:mm

    for (const d of prefs.remindDays) {
      const bills = await prisma.bill.findMany({
        where: { status: BillStatus.PENDING, bank: { userId: user.id }, dueDate: addDaysYMD(today, d) },
        include: { bank: true },
      })
      for (const bill of bills) {
        if (bill.bank.autoDebit) continue
        const message = `到期提醒 D-${d}`
        const alreadySent = await prisma.notificationLog.findFirst({
          where: { billId: bill.id, message, sentAt: { gte: todayStart }, success: true },
        })
        if (alreadySent) continue
        try {
          const r = await sendBillReminder(bill, bill.bank)
          await logNotification(bill.id, 'telegram', message, r.ok, r.error)
        } catch (e) {
          await logNotification(bill.id, 'telegram', message, false, (e as Error).message)
        }
      }
    }
  }
}
```

`processOverdueBills`：標記段原樣；發送迴圈裡 deactivated 檢查後加：

```ts
const prefs = await getEffectivePrefs(bill.bank.userId)
if (!prefs.notifyOverdue) continue // 關掉的人不發也不記 log；之後打開會補一次警告（既定行為）
```

`logNotification` 呼叫點全部改新簽名。`scheduler.ts` 的 import 與呼叫 `processReminderRules()` → `processReminders()`。

- [ ] **Step 4: 改 notification-owner.test.ts 與 overdue.test.ts**

owner 測試：seed 的 `notificationRule.create` 全刪（prefs 不需要列，靠預設）；`processReminderRules` → `processReminders`；斷言不變。overdue 測試加兩案例：

```ts
it('owner with notifyOverdue=false gets marked but not warned', async () => {
  // seed user+bank+過期 bill；prefs: notifyOverdue false
  await prisma.notificationPreference.create({ data: { userId: user.id, notifyOverdue: false } })
  await processOverdueBills(at(9, 30))
  expect((await prisma.bill.findUniqueOrThrow({ where: { id: bill.id } })).status).toBe(BillStatus.OVERDUE)
  expect(sendOverdueWarning).not.toHaveBeenCalled()
})

it('newBill: owner with notifyNewBill=false is skipped', async () => {
  await prisma.notificationPreference.create({ data: { userId: user.id, notifyNewBill: false } })
  await processNewBill(bill, bank)
  expect(sendNewBillAlert).not.toHaveBeenCalled()
})
```

- [ ] **Step 5: 跑三個測試檔全綠；再跑全套 server test**（此時 routes/notification-rules.ts 及其測試仍引用舊 model，預期只剩那幾檔紅——Task 4 處理；其餘必須綠）
- [ ] **Step 6: Commit** `feat(server): reminders and toggles driven by notification prefs`

---

### Task 4: prefs 路由取代 rules 路由

**Files:**
- Create: `apps/server/src/routes/notification-prefs.ts`；Delete: `apps/server/src/routes/notification-rules.ts`
- Modify: `apps/server/src/index.ts`（mount `/api/notification-prefs`）
- Test: Create `apps/server/src/routes/__tests__/notification-prefs.test.ts`；Delete `notification-rules.test.ts`；Modify `tenant-isolation.test.ts`、`role-guard.test.ts` 中對 `/api/notification-rules` 的引用改為 prefs GET/PUT 等價檢查

**Interfaces:**
- Produces:
  - `GET /api/notification-prefs` → `{ remindDays: number[], remindTime: string, notifyNewBill: boolean, notifyOverdue: boolean, lastDelivery: { sentAt, success, message, errorMessage } | null }`（無列時 lazy 建立）
  - `PUT /api/notification-prefs`（zod 驗證；回傳同形狀但無 `lastDelivery`）

- [ ] **Step 1: 寫失敗測試**（沿用 routes 測試既有 app 建構模式，參考原 notification-rules.test.ts 的 setup）：案例＝GET 無列回預設並建列（再查 DB 應有一列）、PUT 正常寫入且回應排序去重（`[1,3,3,7]` → `[7,3,1]`）、PUT 拒絕 31／負數／超過 6 個／`remindTime "9:00"`、GET 的 `lastDelivery` 取自己名下帳單最近一筆且不含他人資料（兩使用者交叉驗證）。
- [ ] **Step 2: 跑測試確認紅**
- [ ] **Step 3: 實作路由**

```ts
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import prisma from '@/prisma.js'
import { getAuthUser } from './auth.js'
import { DEFAULT_PREFS, getEffectivePrefs, normalizeRemindDays } from '@/services/notification-prefs.js'

const app = new Hono()

const prefsSchema = z.object({
  remindDays: z.array(z.number().int().min(0).max(30)).max(6),
  remindTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  notifyNewBill: z.boolean(),
  notifyOverdue: z.boolean(),
})

async function lastDeliveryFor(userId: string) {
  return prisma.notificationLog.findFirst({
    where: { bill: { bank: { userId } } },
    orderBy: { sentAt: 'desc' },
    select: { sentAt: true, success: true, message: true, errorMessage: true },
  })
}

app.get('/', async (c) => {
  const userId = getAuthUser(c).id
  const existing = await prisma.notificationPreference.findUnique({ where: { userId } })
  if (!existing) {
    // Lazy-create so subsequent PUTs are plain updates; unique(userId) race from
    // concurrent GETs is benign — swallow the P2002 and read back.
    await prisma.notificationPreference.create({
      data: { userId, remindDays: JSON.stringify(DEFAULT_PREFS.remindDays), remindTime: DEFAULT_PREFS.remindTime },
    }).catch(() => {})
  }
  const prefs = await getEffectivePrefs(userId)
  return c.json({ ...prefs, lastDelivery: await lastDeliveryFor(userId) })
})

app.put('/', zValidator('json', prefsSchema), async (c) => {
  const userId = getAuthUser(c).id
  const data = c.req.valid('json')
  const remindDays = normalizeRemindDays(data.remindDays)
  const fields = {
    remindDays: JSON.stringify(remindDays),
    remindTime: data.remindTime,
    notifyNewBill: data.notifyNewBill,
    notifyOverdue: data.notifyOverdue,
  }
  await prisma.notificationPreference.upsert({ where: { userId }, create: { userId, ...fields }, update: fields })
  return c.json({ remindDays, remindTime: data.remindTime, notifyNewBill: data.notifyNewBill, notifyOverdue: data.notifyOverdue })
})

export default app
```

`index.ts`：import 與 mount 改 `app.route('/api/notification-prefs', notificationPrefsRoutes)`，移除舊行。

- [ ] **Step 4: 更新 tenant-isolation／role-guard 測試**：原本打 `/api/notification-rules` 的案例改打 `/api/notification-prefs`（隔離：A 的 `lastDelivery` 看不到 B 的 log；guard：member 可存取 prefs——它不是 adminOnly）。
- [ ] **Step 5: 全套 server test 綠 + `pnpm typecheck`（server 套件必須過；web 尚未動不受影響）**
- [ ] **Step 6: Commit** `feat(server): notification-prefs endpoints replace rules CRUD`

---

### Task 5: onboarding-status 端點

**Files:**
- Modify: `apps/server/src/routes/integrations.ts`
- Test: Create `apps/server/src/routes/__tests__/onboarding-status.test.ts`

**Interfaces:**
- Produces: `GET /api/onboarding-status` → `{ emailConfigured: boolean, hasActiveBank: boolean, botConfigured: boolean, telegramBound: boolean }`（self-scoped、無 IMAP live probe）

- [ ] **Step 1: 失敗測試**：四布林各自翻轉的種子情境（無 imap 憑證／有；0 家啟用銀行、僅停用銀行／有啟用；bot token 設定與否——mock `isConfigured`；telegramChatId null／有值），加一個「B 使用者的銀行不影響 A 的 hasActiveBank」。
- [ ] **Step 2: 確認紅**
- [ ] **Step 3: 實作**（加在 integrations.ts，`currentUser` helper 已存在）：

```ts
app.get('/onboarding-status', async (c) => {
  const me = await currentUser(c)
  const hasActiveBank = me ? (await prisma.bank.count({ where: { userId: me.id, isActive: true } })) > 0 : false
  return c.json({
    emailConfigured: !!(me?.imapUser && me?.imapPassword),
    hasActiveBank,
    botConfigured: await telegramConfigured(),
    telegramBound: !!me?.telegramChatId,
  })
})
```

- [ ] **Step 4: 綠 → Commit** `feat(server): onboarding-status endpoint for setup progress`

---

### Task 6: shared/web types、composable、偏好面板卡、設定頁換裝

**Files:**
- Modify: `packages/shared/types.ts`（刪 `NotificationRuleDTO` 與 `NotificationChannel`；新增 `NotificationPrefsDTO`、`LastDeliveryDTO`、`OnboardingStatusDTO`）
- Modify: `apps/web/composables/useApi.ts`（加 `put`）、`apps/web/composables/useSettingsApi.ts`、`apps/web/types/settings.ts`（刪 `CHANNEL_OPTIONS`，改 re-export）
- Create: `apps/web/components/settings/NotificationPrefsCard.vue`
- Delete: `apps/web/components/settings/NotificationRuleList.vue`、`NotificationRuleDialog.vue`
- Modify: `apps/web/pages/settings/index.vue`（規則清單/對話框/刪除確認整段移除，換偏好卡；本 task 先不動分區結構）

**Interfaces:**
- Consumes: Task 4/5 端點。
- Produces（web 後續 task 依賴）：
  - shared：`interface NotificationPrefsDTO { remindDays: number[]; remindTime: string; notifyNewBill: boolean; notifyOverdue: boolean; lastDelivery?: LastDeliveryDTO | null }`、`interface LastDeliveryDTO { sentAt: string; success: boolean; message: string; errorMessage?: string | null }`、`interface OnboardingStatusDTO { emailConfigured: boolean; hasActiveBank: boolean; botConfigured: boolean; telegramBound: boolean }`
  - composable：`getNotificationPrefs()`、`updateNotificationPrefs(data)`（PUT）、`getOnboardingStatus()`；`useApi` 新增 `put<T>(path, body)`
  - `NotificationPrefsCard` props：`{ prefs: NotificationPrefsDTO, botConfigured: boolean, telegramBound: boolean, isAdmin: boolean }`，emit `refresh`

- [ ] **Step 1: types 與 composable**（useApi 的 `put` 與 `patch` 同構，method 'PUT'；useSettingsApi 刪四個 rules 方法、新增上列三個）
- [ ] **Step 2: NotificationPrefsCard.vue**——關鍵行為：
  - props 進來後複製成本地 state；任何變更 → 800ms debounce → `updateNotificationPrefs`（成功 toast「通知設定已更新」，失敗 toast 並 emit refresh 回同步）
  - chips：顯示 `remindDays`（已排序），✕ 移除；新增區＝快捷鈕 7/3/1（已存在則隱藏）＋數字 input（0–30）＋「加入」；達 6 個時新增區 disabled
  - `remindDays` 空時顯示「未設定到期提醒——加入天數後才會在到期前收到訊息」
  - 兩個 Switch：掃到新帳單通知我／逾期時警告我
  - 頂部狀態列：`lastDelivery` null 顯示「尚未發送過通知」；success 顯示「上次發送：{格式化 sentAt} ✓」；失敗顯示紅字「⚠ 上次發送失敗：{errorMessage}」
  - 警示條：`!botConfigured` → admin 看「尚未設定 Telegram Bot，通知無法送達」＋連結 `#system`；member 看「管理員尚未設定 Telegram Bot，請聯絡管理員」；`botConfigured && !telegramBound` → 「尚未綁定 Telegram，往下到『送達方式』完成綁定」
- [ ] **Step 3: settings/index.vue 接線**——`rules` 相關 state/函式（dialog、delete dialog、`openCreateDialog` 等）全刪；`fetchSelfData` 改抓 `getNotificationPrefs()`＋`getOnboardingStatus()`；`<SettingsNotificationRuleList>` 段換 `<SettingsNotificationPrefsCard :prefs="prefs" :bot-configured="onboarding?.botConfigured ?? false" :telegram-bound="onboarding?.telegramBound ?? false" :is-admin="isAdmin" @refresh="fetchSelfData" />`
- [ ] **Step 4: 驗證**：`pnpm typecheck`、`pnpm --filter @bill-alarm/web lint`、server test 全綠；`grep -rn "NotificationRule\|CHANNEL_OPTIONS\|listRules" apps packages --include='*.ts' --include='*.vue'` 無殘留
- [ ] **Step 5: Commit** `feat(web): notification prefs panel replaces rule list`

---

### Task 7: Telegram 送達方式卡（自動輪詢）＋ admin 卡瘦身

**Files:**
- Create: `apps/web/components/settings/TelegramDeliveryCard.vue`；Delete: `TelegramBindCard.vue`
- Modify: `apps/web/components/settings/IntegrationTelegram.vue`（移除「發送測試（給自己）」按鈕與 `handleTest`/`testingTelegram`；說明文案改「透過 @BotFather 建立 Bot 取得 Token，全系統設定一次。成員各自到『通知』區綁定後才會收到通知。」）
- Modify: `apps/web/pages/settings/index.vue`（帳號區的 `<SettingsTelegramBindCard />` 移除；通知區偏好卡下方掛 `<SettingsTelegramDeliveryCard :bot-configured="..." @refresh="fetchSelfData" />`）

**Interfaces:**
- Consumes: `settingsApi.telegramBind/telegramConfirm/telegramUnbind/testTelegram`、`useAuth().me.telegramBound`、`isApiErrorStatus`（`@/lib/utils` 既有）。
- Produces: `TelegramDeliveryCard` props `{ botConfigured: boolean }`，emit `refresh`。

- [ ] **Step 1: 實作卡片**——狀態機與輪詢核心：

```ts
const POLL_INTERVAL_MS = 3000
const POLL_MAX_TRIES = 40 // ≈ 2 minutes
const deepLink = ref<string | null>(null)
const polling = ref(false)
const timedOut = ref(false)
let pollTimer: ReturnType<typeof setInterval> | null = null
let tries = 0

function stopPolling() {
  if (pollTimer) clearInterval(pollTimer)
  pollTimer = null
  polling.value = false
}

async function startBind() {
  timedOut.value = false
  const res = await settingsApi.telegramBind()   // 400 → toast「尚未設定 Bot」(catch)
  deepLink.value = res.deepLink
  tries = 0
  polling.value = true
  pollTimer = setInterval(poll, POLL_INTERVAL_MS)
}

async function poll() {
  tries += 1
  try {
    await settingsApi.telegramConfirm()          // 200 = bound
    stopPolling()
    deepLink.value = null
    await fetchMe()
    toast.success('Telegram 綁定成功', { description: '之後的帳單通知會發送給你。' })
  }
  catch (e) {
    if (isApiErrorStatus(e, 410)) {              // code expired
      stopPolling()
      deepLink.value = null
      toast.error('綁定連結已過期，請重新產生')
      return
    }
    // 404 not_seen 與暫時性網路錯誤：靜默續等
    if (tries >= POLL_MAX_TRIES) {
      stopPolling()
      timedOut.value = true                       // 顯示「還沒偵測到…」＋重試鈕（重試＝poll 一次+重啟輪詢）
    }
  }
}

onUnmounted(stopPolling)
```

Template 三態：`!botConfigured` → 灰狀態文案（無按鈕）；未綁定 → 初始「綁定 Telegram」／已產生連結 →「開啟 Telegram」(href=deepLink) ＋「等待你在 Telegram 按下 Start…」spinner／timedOut → 提示＋「重試」；已綁定（`me.telegramBound`）→ ✓ ＋「發送測試訊息」（呼叫 `testTelegram`，沿用原 IntegrationTelegram 的 handleTest 寫法）＋「解除綁定」。

- [ ] **Step 2: 接進設定頁、刪舊卡**；`grep -rn "TelegramBindCard" apps/web` 無殘留
- [ ] **Step 3: typecheck ＋ lint 綠**
- [ ] **Step 4: Commit** `feat(web): telegram delivery card with auto-confirm polling`

---### Task 8: 資料來源拆分（信箱授權瘦身＋掃描卡）與設定頁重分區

**Files:**
- Create: `apps/web/components/settings/ScanCard.vue`
- Modify: `apps/web/components/settings/IntegrationEmail.vue`（`handleScan`/`useScanEvents`/進度條整段移除；State 2 只剩連線狀態列＋「修改授權」；教學 dialog 保留）
- Modify: `apps/web/pages/settings/index.vue`（最終分區：`#notifications` 通知〔偏好卡＋送達卡＋行事曆卡〕→ `#data-source` 資料來源〔信箱卡＋掃描卡〕→ 帳號〔PWA＋身分〕→ `#system` 系統管理；各 section 加 `:id`）

**Interfaces:**
- Consumes: `settingsApi.triggerScan/listScanLogs`、`useScanEvents`（自 IntegrationEmail 遷入 ScanCard）、`OnboardingStatusDTO`。
- Produces: `ScanCard` props `{ emailConfigured: boolean, hasActiveBank: boolean }`。

- [ ] **Step 1: ScanCard.vue**——遷移原 IntegrationEmail 的 `handleScan` 與進度 UI，外加：掛載時 `listScanLogs(1)` 取最近一筆，顯示「上次掃描：{startedAt 格式化}・掃描 {scanned} 封・新帳單 {newBillsCount}・錯誤 {errorCount}」（無紀錄顯示「尚未掃描過」）；掃描完成後刷新此摘要；`!emailConfigured` → 按鈕 disabled＋「先完成上方信箱授權」；`emailConfigured && !hasActiveBank` → 警示「尚未啟用任何銀行，掃不到帳單」＋連結 `/banks`；「查看掃描紀錄」連 `/scan-logs`。
- [ ] **Step 2: IntegrationEmail 瘦身**（已授權態＝一行狀態列：✓/✗＋email＋「修改授權」toggle 開表單；未授權態不變）
- [ ] **Step 3: settings/index.vue 重排 section 順序與標題**（通知／資料來源／帳號／系統管理），行事曆卡移入通知區
- [ ] **Step 4: typecheck＋lint 綠；`pnpm --filter @bill-alarm/server test` 全綠**
- [ ] **Step 5: Commit** `feat(web): data-source section splits mailbox auth from scanning; settings regrouped`

---

### Task 9: 儀表板設定進度卡

**Files:**
- Create: `apps/web/components/OnboardingProgressCard.vue`
- Modify: `apps/web/pages/index.vue`（原 `emailReady` hint 卡與其 onMounted 抓取整段移除，換 `<OnboardingProgressCard />`）

**Interfaces:**
- Consumes: `getOnboardingStatus()`、`useAuth().isAdmin`。

- [ ] **Step 1: 元件**——掛載抓 `getOnboardingStatus`；抓完前與「三步全 ✓」時 render 空（防閃，沿用原 hint 的策略：抓失敗也 render 空）；三步列：
  1. 連接信箱 → 未完成連 `/settings#data-source`
  2. 啟用你的銀行 → `/banks`
  3. 打開 Telegram 通知 → member：`botConfigured ? '/settings#notifications'（去綁定） : 顯示「等待管理員設定 Bot」仍連 #notifications`；admin：`!botConfigured ? '/settings#system'（設定 Bot Token） : '/settings#notifications'（去綁定）`
  已完成步驟顯示 ✓ 與刪除線樣式。
- [ ] **Step 2: typecheck＋lint 綠**
- [ ] **Step 3: Commit** `feat(web): dashboard onboarding progress card`

---

### Task 10: 文案歸位、殘留清掃與全量驗證

**Files:**
- Modify: `apps/web/components/settings/IntegrationCalendar.vue`（首段文案改「另一種提醒方式：把到期日放進你的日曆。事件內建到期前 1 天／1 小時提醒，不需 OAuth。複製網址貼到任何支援 iCalendar 的 App。」）
- Modify: `apps/web/pages/settings/index.vue`（頁面副標題改「通知、資料來源與帳號」）；`README.md` 若提及「通知規則」則同步改為偏好描述

- [ ] **Step 1: 文案修改**
- [ ] **Step 2: 殘留清掃**：`grep -rn "notification-rules\|NotificationRule\|通知規則" apps packages README.md --include='*.ts' --include='*.vue' --include='*.md'` 逐一處理（docs/superpowers 與 improvement-report 歷史文件除外）
- [ ] **Step 3: 全量驗證**：`pnpm --filter @bill-alarm/server test`、`pnpm typecheck`、`pnpm --filter @bill-alarm/web lint`、`pnpm build` 全綠
- [ ] **Step 4: 手動煙霧測試**（dev server + dev web）：設定頁四區渲染、偏好改動即存、掃描卡摘要、進度卡三態、`/api/notification-prefs` GET/PUT curl 檢查
- [ ] **Step 5: Commit** `feat: notification & auth UX overhaul — copy, cleanup, verification`

## Self-Review 紀錄

- **Spec 覆蓋**：§1 分區→T8；§2 進度卡＋端點→T5/T9；§3 模型/migration/API/排程/面板→T1–T4/T6；§4 送達卡→T7;§5 行事曆文案→T10；§6 資料來源→T8；§7 admin 卡→T7；§8 錯誤浮出→T6（狀態列＋警示條）/T7/T9；§9 測試→各 task 內建；§10 檔案清單與 grep 對齊。
- **型別一致性**：`EffectivePrefs`/`NotificationPrefsDTO` 欄位名一致（`remindDays/remindTime/notifyNewBill/notifyOverdue`）；`processReminders` 名稱在 T3 定義、scheduler 同步；`OnboardingStatusDTO` 四欄位 T5/T6/T9 一致。
- **無佔位符**：所有程式步驟附實碼或精確 before/after 指示；「原樣保留」僅指向已在本檔或現行程式碼中完整存在的段落。
