# Health Fixes Plan B（Phase 6–10：路由強化、Email 抽象、Secrets、前端收斂、文件）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完成 `docs/superpowers/specs/2026-07-09-health-report-fixes-design.md` 的 Phase 6–10：全域錯誤處理與請求防護、adminOnly middleware 與路由拆分、掃描鎖與 SSE 修正、async scrypt、LLM timeout、pdfPassword 遮罩、Email 抽象修正、secrets at-rest 加密、前端型別/格式化/元件收斂、文件同步。

**Architecture:** 承接 Plan A（已合併 main @ 6ec696f）。所有 Plan A 的既有事實適用：`dueDate` 為 YMD 字串、typecheck 閘門 `pnpm --filter @bill-alarm/server typecheck`、CI 跑 test+typecheck+lint、shared 有 date/format/scan 模組。

**Tech Stack:** 同 Plan A。無新增執行期依賴（T10 的加密用 node:crypto）。

## Global Constraints

- 基準 gates（每個 task 完成條件）：server test 116+（隨 task 遞增）、shared 11、`pnpm --filter @bill-alarm/server typecheck` 0、`pnpm -r lint` 0。前端 task 另加 `pnpm --filter @bill-alarm/web generate` 成功。
- 所有既有 API URL 不變；回應欄位只依本 plan 明列者變動。
- Commit 用 conventional commits，結尾 `Claude-Session: https://claude.ai/code/session_01SSny4tRPZBGcNyo5mp8FxA`。
- **凡執行過 `pnpm add`／`pnpm remove` 的 task，`pnpm-lock.yaml` 必須進同一個 commit**（Plan A 教訓）。
- 測試不得裸呼叫依賴真實時鐘的函式（Plan A 教訓：一律注入 `now`；新測試檔比照 `reminder-timing.test.ts` 的 `base`/`at()` 模式）。
- 測試檔結構模式：路由測試 mirror `apps/server/src/routes/__tests__/banks.test.ts`；服務測試 mirror `apps/server/src/services/__tests__/overdue.test.ts`。
- 分支：`refactor/health-fixes-plan-b`。不 push。

---

### Task 1: 全域錯誤處理 + 全域 bodyLimit + 移除 cors + setup race

**Files:**
- Modify: `apps/server/src/index.ts`
- Modify: `apps/server/src/routes/auth.ts`（setup P2002）
- Test: `apps/server/src/routes/__tests__/error-handling.test.ts`（新建）

**Interfaces:**
- Produces: 任何路由拋出未捕捉例外 → 500 JSON `{ error: '伺服器內部錯誤' }`（pino error log 完整記錄，回應不洩內部訊息）。全域 body 上限 25MB（auth 子路由維持既有 16KB）。

- [ ] **Step 1: 失敗測試**：新測試檔（admin cookie 模式照 banks.test.ts）——(a) 在測試內對 import 進來的 `app` 追加 `app.get('/api/__test-throw', () => { throw new Error('secret detail') })`，帶 cookie 請求它，斷言 500、body 為 `{ error: '伺服器內部錯誤' }`、body 不含 `secret detail`；(b) `POST /api/auth/setup` 併發 race：先建 admin 後再打 setup 應回 403（既有語意），再以直接 `prisma.user.create` 模擬 race 後打 setup 觸發 P2002 路徑（可用 vi.spyOn(prisma.user, 'count').mockResolvedValueOnce(0) 強制通過前置檢查）→ 斷言 403 而非 500。RED 確認（目前 (a) 回 Hono 預設文字 500）。
- [ ] **Step 2: 實作** `index.ts`：

```ts
app.onError((err, c) => {
  logger.error({ err: err.message, stack: err.stack, path: c.req.path }, 'Unhandled route error')
  return c.json({ error: '伺服器內部錯誤' }, 500)
})
app.use('/api/*', bodyLimit({ maxSize: 25 * 1024 * 1024, onError: (c) => c.json({ error: '請求內容過大' }, 413) }))
```

（掛在 authGuard 之前；auth 子路由自己的 16KB limit 先觸發、維持不變。）刪除 `import { cors } from 'hono/cors'` 與 `app.use('/api/*', cors())`（同源部署 + cookie auth，CORS 中介層無作用且放寬無憑證跨源讀取）。`auth.ts` setup handler 的 `prisma.user.create` 包 try/catch：`(e as {code?:string}).code === 'P2002'` → `c.json({ error: '已完成初始化' }, 403)`（比照 users.ts:41 的既有模式）。
- [ ] **Step 3: 全綠 + commit** `fix(server): global error handler, request size cap, drop no-op cors, setup race guard`

---

### Task 2: `adminOnly` middleware 取代 ADMIN_ONLY regex 清單

**Files:**
- Create: `apps/server/src/middleware/admin-only.ts`
- Modify: `apps/server/src/routes/auth.ts`（刪 ADMIN_ONLY 清單與 authGuard 內的比對段）、`users.ts`、`config.ts`、`system.ts`
- Test: 既有 `role-guard.test.ts` **內容不改、必須全綠**（權限語意不變的鐵證）

**Interfaces:**
- Produces:

```ts
// middleware/admin-only.ts
import type { Context } from 'hono'
import { getAuthUser } from '@/routes/auth.js'

/** Mount after authGuard. 403s non-admin users. */
export async function adminOnly(c: Context, next: () => Promise<void>): Promise<Response | void> {
  if (getAuthUser(c).role !== 'admin') return c.json({ error: 'forbidden' }, 403)
  return next()
}
```

- [ ] **Step 1**: 建 middleware（上方全文）。掛載對照現行 ADMIN_ONLY 清單**逐條**："users.ts → `app.use('*', adminOnly)`（檔頭註解同步更新）；config.ts → 四個 POST handler 與 `GET /status` 各自 `app.post('/telegram', adminOnly, zValidator(...), handler)` 形式插入；system.ts → `POST /llm/test` 同法。`/llm/status`、`/llm/suggest-rule` 維持 member 可用（現狀）。
- [ ] **Step 2**: `auth.ts` 刪除 `ADMIN_ONLY` 常數與 authGuard 中 `if (session.user.role !== 'admin') {...denied...}` 區塊（HEAD→GET 正規化一併消失——middleware 掛在路由上天然照 method 命中；HEAD 請求由 Hono 以 GET handler 服務，行為等價）。
- [ ] **Step 3**: `pnpm --filter @bill-alarm/server test -- role-guard` 全綠 → 全套 gates → commit `refactor(server): per-route adminOnly middleware replaces central regex list`

---

### Task 3: system.ts 拆檔 + settings.ts 改名（URL 零變動）

**Files:**
- Create: `apps/server/src/routes/scan.ts`（`POST /email/scan`、`GET /scan-events`、`GET /scan-logs`）、`parser-lab.ts`（`/parser/*`、`GET /email/search`、`GET /email/message/:id`、`GET /email/message/:id/parse`）、`llm.ts`（`/llm/*`）、`integrations.ts`（`GET /integrations/status`、`POST /telegram/test`）
- Delete: `apps/server/src/routes/system.ts`
- Rename: `apps/server/src/routes/settings.ts` → `notification-rules.ts`
- Modify: `apps/server/src/index.ts`（imports + `app.route('/api', …)` ×4）

**Steps:** 純機械搬移——每個 handler 連同其 imports 原樣移入新檔，`currentUser` helper 複製到需要它的檔案（scan.ts 與 parser-lab.ts 各一份 3 行 helper 可接受；或移入 `routes/auth.ts` 旁 export——擇一並在 report 說明）。index.ts 掛載順序維持（全部掛 `/api`）。**驗證**：`git diff` 中不得出現任何 handler 邏輯行變動（搬移前後 handler 本體 diff 為零）；全套測試（尤其 email-debug、tenant-isolation、role-guard）不改內容全綠。Commit `refactor(server): split system routes by concern; rename settings to notification-rules`

---

### Task 4: 掃描互斥鎖 + SSE snapshot per-user + SSE buffering 修正

**Files:**
- Modify: `apps/server/src/services/email-parser.ts`（鎖）、`scan-events.ts`（Map snapshot）、`routes/scan.ts`（409 + X-Accel-Buffering）、`scheduler.ts`（撞鎖 skip + log）
- Modify: `nginx.conf`
- Test: `apps/server/src/services/__tests__/scan-lock.test.ts`（新建）＋ scan-events snapshot 測試

**Interfaces:**
- `runScanWithLog`：同一 userId 已在掃描中 → throw `ScanInProgressError`（export class）；scan route catch → 409 `{ error: '掃描進行中，請稍候' }`；cron 呼叫端 catch → log skip。
- `ScanEventBus.snapshot` → `Map<string, ScanSnapshot>`；`getSnapshot(userId)`；complete 時 `delete`。SSE catch-up 改 `getSnapshot(me.id)`（`eventVisibleTo` 對 snapshot 的檢查因此變成恆真，可簡化）。
- scan.ts SSE handler 開頭：`c.header('X-Accel-Buffering', 'no')`。
- nginx.conf 加 location：

```nginx
    location /api/scan-events {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 1h;
    }
```

- [ ] **Step 1 失敗測試**：(a) mock provider 讓 scan 卡在進行中（withSession 內 await 一個受控 promise），並發第二次 `runScanWithLog` 同 user → throw；不同 user → 不互擋；finally 釋放後可再掃。(b) snapshot：userA start 後 userB start，`getSnapshot(userA.id)` 仍回 A 的 start 事件；B complete 不清 A。RED 確認。
- [ ] **Step 2 實作**（鎖為 module-level `const scanning = new Set<string>()`，`runScanWithLog` 進入時 `if (scanning.has(user.id)) throw new ScanInProgressError()`，try/finally 釋放）。
- [ ] **Step 3**: 全綠 + commit `fix(server): per-user scan mutex, per-user SSE snapshot, disable proxy buffering for SSE`。**部署後人工驗證進度即時性**（列入 Plan B 完成定義）。

---

### Task 5: async scrypt

**Files:** `apps/server/src/services/auth.ts`、呼叫端（`routes/auth.ts`、`routes/users.ts`）、既有 auth 測試同步 await 化。

**Steps:** `hashPassword`/`verifyPassword` 改 `Promise<...>`（`node:util promisify(scrypt)`），參數/輸出格式不變（既有 hash 相容）；所有呼叫端加 await（typecheck 會列舉）；`services/__tests__/auth.test.ts` 加一個「舊格式 hash 仍可驗證」的相容性 case（用 scryptSync 產生固定 hash 字串驗 async verify）。全綠 + commit `perf(server): async scrypt off the event loop`

---

### Task 6: LLM timeout 統一 60s

**Files:** `apps/server/src/services/llm-parser.ts`、`pdf-parser.ts`（`withTimeout` 移出）、Create: `apps/server/src/services/util/timeout.ts`
**Steps:** `withTimeout` 搬到 util 並兩處共用；`invokeOllama`/`invokeOpenAI` 的 fetch 加 `signal: AbortSignal.timeout(60_000)`；Gemini：查 `@google/genai` 安裝版型別是否支援 `httpOptions.timeout`（讀 node_modules 型別），支援則用之、否則以 `withTimeout(..., 60_000, 'LLM 請求')` 包呼叫。測試：mock fetch 永不 resolve → 斷言 60s 內 reject（vi.useFakeTimers + advanceTimersByTime；AbortSignal.timeout 在 fake timers 下的行為要驗證——若不受 fake timers 控制，改以 withTimeout 統一三個 provider 並測 withTimeout 本身）。全綠 + commit `fix(server): 60s timeout on all LLM providers`

---

### Task 7: email status 輕量化 + banks enable 密碼 + bills paidAt 轉移

**Files:** `apps/server/src/routes/email.ts`、`banks.ts`、`bills.ts`、web `pages/index.vue`、對應測試（email-status.test.ts 既有檔擴充、banks.test.ts、bills-validation.test.ts）

**Interfaces / 行為：**
- `GET /api/email/status`：預設**不連 IMAP**，回 `{ hasCredentials, host, port, user }`；`?verify=1` 時附 `connected`/`message`/`email`（現行為）。設定頁元件（`IntegrationEmail.vue` 的呼叫點）改帶 `verify=1`；dashboard `pages/index.vue` 用預設版。
- `POST /api/banks/enable/:code` 對既有 record 重啟用時，body 有 `pdfPassword` 則一併更新。
- `PATCH /api/bills/:id`：status 轉為 `paid` 且未帶 paidAt → `paidAt = new Date()`；由 `paid` 轉出 → `paidAt = null`。抽 10 行 helper 於 bills.ts 內，pay/unpay 路由改用同 helper。

**Steps:** TDD 各 2-3 case（email/status 不帶 verify 時不觸發 IMAP——mock `verifyConnectionFor` 斷言未被呼叫；enable 帶密碼後 DB 值更新；PATCH status 轉移 paidAt 斷言）。全綠 + commit `fix(server): lazy email status, enable-with-password, paidAt state transitions`

---

### Task 8: pdfPassword 遮罩（API + 前端編輯 UX）

**Files:** `apps/server/src/routes/banks.ts`（GET 列表 select/map + PATCH 語意）、`packages/shared/types.ts`（`BankDTO`）、web `pages/banks/index.vue`（編輯 dialog）、banks.test.ts 擴充

**Interfaces / 行為（spec §6）：**
- `GET /api/banks`：顯式 map，移除 `pdfPassword`，加 `hasPdfPassword: boolean`；其餘欄位不變（`parserConfig` 保留）。shared 新增 `BankDTO`（照實際回應形狀，含 `hasPdfPassword`、`_count`、`bankAccount`）。
- `PATCH /api/banks/:id` 的 `pdfPassword`：缺席或 `''` → 不變；`null` → 清除；非空字串 → 覆寫。
- 前端編輯 dialog：密碼欄不再回填現值；placeholder 依 `hasPdfPassword` 顯示「已設定（留空維持不變）」/「未設定」；新增「清除密碼」按鈕（送 `null`）；showPassword eye 按鈕保留給新輸入值。
- **PDF 判別測試（MT carry）**：嘗試在測試中以 mupdf 產生帶密碼的最小 PDF fixture（`mupdf` 已是依賴；查其 save 選項是否支援加密）。可行 → `GET /:id/pdf` 外人 404 判別測試（fixture 有 pdfPath）；不可行 → 以 `vi.spyOn(fs, 'readFile')` 斷言外人請求不觸發檔案讀取，並在 report 記錄選了哪條路。

**Steps:** TDD → 實作 → web generate 過 → commit `feat: mask bank pdf passwords in API, leave-empty-keeps edit semantics`

---

### Task 9: Email 抽象修正（結構化 SearchOptions）

**Files:** `apps/server/src/services/email/types.ts`、`providers/gmail-imap.ts`、`email-parser.ts`（呼叫端改傳結構化條件）、`routes/parser-lab.ts`（debug 搜尋路由保留自由字串、標註 Gmail-only）、`services/__tests__/mailbox.test.ts` 擴充

**Interfaces（spec §5）：**

```ts
export interface SearchCriteria {
  senders: string[]        // OR-matched FROM patterns
  sinceDays: number
  hasAttachment: boolean   // gmail fast path only; standard IMAP ignores (post-filtered by PDF check)
}
export interface EmailSession {
  search(criteria: SearchCriteria): Promise<MessageRef[]>
  searchRaw?(query: string): Promise<MessageRef[]>  // gmail-only debug escape hatch
  fetch(ref: MessageRef): Promise<EmailMessage | null>
}
```

- gmail host（`imap.gmail.com` 或 `*.gmail.com`）→ 由 criteria 組 `gmailraw`（含 `SCAN_GMAIL_QUERY_EXTRA`，語意同現制）；其他 host → imapflow 查詢物件 `{ since: Date, or: [...] }`（**實作時讀 node_modules/imapflow 型別確認 `or` 的 n-ary 語意，不支援則二元巢狀**，在 report 記錄）；`SCAN_GMAIL_QUERY_EXTRA` 於非 gmail host 略過並 log 一行。
- `email-parser.ts` 不再拼 Gmail 語法字串（`senderPatterns`/`query` 組字刪除，改傳 criteria）。
- debug 路由 `GET /email/search` 用 `searchRaw`（gmail-only 工具，回應加 `note: 'Gmail-only debug query'`）。

**Steps:** TDD（mock ImapFlow：gmail host 斷言收到 gmailraw 字串內容；非 gmail host 斷言收到結構化查詢物件含 since + or-from）→ 實作 → 全綠 → commit `refactor(server): structured email search criteria; non-gmail IMAP servers now work`

---

### Task 10: Secrets at-rest 加密

**Files:** Create `apps/server/src/services/secrets.ts` + `__tests__/secrets.test.ts`；Modify `services/settings.ts`（敏感 key 名單透明加解密）、`routes/email.ts`（imapPassword 寫入）、`scheduler.ts`/`email/index.ts`（imapPassword 讀取點）、`routes/banks.ts`（pdfPassword 寫入）、pdfPassword 讀取點（`bills.ts` pdf/reparse、`parser-lab.ts` bootstrap、`email-parser.ts` 掃描）
- 讀取點以 helper 收斂：`getMailboxCredentials(user)` 與 `getBankPdfPassword(bank)`（回解密值）。

**Interfaces（spec §6）：**

```ts
// services/secrets.ts
const PREFIX = 'enc:v1:'
export function encryptSecret(plain: string): string   // no key -> plain unchanged
export function decryptSecret(stored: string): string  // no prefix -> passthrough (legacy plaintext)
export function encryptionEnabled(): boolean
```

AES-256-GCM；金鑰 `sha256(ENCRYPTION_KEY)`；格式 `enc:v1:<b64 iv>:<b64 ct||tag>`。無 `ENCRYPTION_KEY` → 明碼原樣 + 開機 `logger.warn` 一次（index.ts）。敏感 settings key 名單：`telegram_bot_token`、`gemini_api_key`、`openai_api_key`（settings.ts 內常數 Set；get/set 透明處理；**env 優先值不加解密**）。既有明碼值：讀取相容（無前綴 passthrough）、下次寫入自然升級。

**Steps:** TDD（roundtrip、passthrough、壞前綴/錯 key 拋錯、無 key 時 encrypt 回原文）→ 實作 → 讀寫點收斂 → 手動驗證：測試中 set ENCRYPTION_KEY 後 setSetting → DB 原始值帶 `enc:v1:` 前綴（直接查 prisma.setting 斷言）→ 全綠 → commit `feat(server): optional at-rest encryption for mailbox/pdf/api-key secrets`。README 的 `ENCRYPTION_KEY` 說明在 B14。

---

### Task 11: 前端型別收斂（composables 去 any）

**Files:** `packages/shared/types.ts`（DTO 對齊實際回應：`BillDTO` 補 `bank` 完整欄位/`billingPeriod`/`paidAt` 等、`BillListResponse`、`BankDTO`（B8 已建）、`NotificationRuleDTO`）、web `composables/*.ts` 全部標型別、web `types/settings.ts` 刪除與 shared 重複者改 re-export、`eslint.config.mjs` 的 any 豁免清單隨修隨刪、web 既有 7 個 typecheck 錯誤修復（`useApi.ts` 2、`bills/[id].vue` 2、`uno.config.ts` 2、`ScanConfigCard.vue` 1）、刪 `useSettingsApi.getIntegrationStatus`（先 grep 佐證無消費者；有則保留並記錄）
- Remove deps: `pnpm --filter @bill-alarm/web remove radix-vue`、`pnpm --filter @bill-alarm/server remove @types/node-cron`（**lockfile 進 commit**）

**Steps:** 先跑 `pnpm --filter @bill-alarm/web exec nuxt typecheck` 記錄基線 7 錯 → 逐檔修 → composables 標型別（歸零 any 豁免清單，最終 eslint override 區塊整個刪除，含 Plan A 遺留的空 `{ rules: {} }`）→ typecheck 0 + generate 成功 + 全套 gates → commit `refactor(web): typed composables via shared DTOs; drop dead deps`

---

### Task 12: 格式化收斂 + `<DaysRemaining>` 元件

**Files:** Create `apps/web/components/DaysRemaining.vue`；Modify `pages/index.vue`、`pages/bills/index.vue`、`pages/bills/[id].vue`（刪本地 `formatAmount`/`formatDate`/`daysUntil`/inline badge，改用 `@bill-alarm/shared/format`+`date` 與新元件）、`pages/settings/users.vue`（formatDate → 保留本地？此頁 format 的是 createdAt timestamp 非 YMD——改用 `new Date(...).toLocaleDateString('zh-TW')` 或留現狀，report 說明）

**`DaysRemaining.vue`（全文）：**

```vue
<script setup lang="ts">
import { daysRemainingInfo, type DaysRemainingTone } from '@bill-alarm/shared/format'

const props = defineProps<{ dueDate: string; status?: string }>()

const TONE_CLASS: Record<DaysRemainingTone, string> = {
  overdue: 'text-red-500 bg-red-500/10',
  today: 'text-red-500 bg-red-500/10',
  soon: 'text-yellow-500 bg-yellow-500/10',
  normal: 'text-muted-foreground bg-muted',
}

const info = computed(() =>
  props.status === 'paid' || props.status === 'no_payment' ? null : daysRemainingInfo(props.dueDate))
</script>

<template>
  <span
    v-if="info"
    class="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium"
    :class="TONE_CLASS[info.tone]"
  >{{ info.text }}</span>
</template>
```

**Steps:** 三頁替換（`index.vue` 刪 inline `defineComponent` DaysRemainingBadge；`[id].vue` 刪 `daysRemainingInfo` computed 改元件；文字/樣式 1:1 保持）→ generate + gates → commit `refactor(web): shared formatting helpers and DaysRemaining component`

---

### Task 13: banks 頁拆分

**Files:** Create `apps/web/components/banks/PresetBankSection.vue`、`CustomBankSection.vue`、`BankAccountSection.vue`、`BankEditDialog.vue`、`BankAccountDialog.vue`；Modify `pages/banks/index.vue`（剩資料抓取與組裝，目標 <200 行）

**Steps:** 行為與樣式 1:1 搬移（props/emits 介面在實作時依現有 state 切分並記錄於 report）；順修 3.6 已知問題：`index.vue:381` 的 Switch handler 補 catch + toast。手動驗證：dev server 起來後 banks 頁四個互動（啟用/停用、編輯、自訂新增、帳戶 CRUD）各走一次（controller 於完成定義統一驗證，task 內以 generate + 讀碼 self-review 為準）。Commit `refactor(web): decompose banks page into section components`

---

### Task 14: 文件同步 + 收尾

**Files:** `README.md`、`.claude/CLAUDE.md`、`docs/improvement-report.md`（標註已處理項）、根 `package.json`（`pnpm.onlyBuiltDependencies` 遷至 pnpm 10 的新位置——查 pnpm 文件確認是 `pnpm-workspace.yaml` 的 `onlyBuiltDependencies`）、`.env.example`（若存在，補 `ENCRYPTION_KEY`）

**README 修正清單：** compose 範例 port `:80`；Gmail API/OAuth → per-user IMAP（App Password）；Google Calendar → ICS feed 訂閱；銀行表補 hsbc_tw/chb/fubon；LLM 三 provider；新增 `ENCRYPTION_KEY`（選用）與 `TZ`說明；升級注意（dueDate migration 前備份 `data/bill-alarm.db`）。
**CLAUDE.md：** `src/db/` → `prisma/` + `src/prisma.ts`；通知敘述改 Telegram + ICS；補慣例三條：dueDate 為 YMD 字串（shared/date.ts 是唯一日曆邏輯來源）、adminOnly middleware 掛路由處、secrets 經 services/secrets.ts。
**improvement-report.md：** 每節加一行「✅ 已於 v0.4 處理（commit range）」或「➡️ 追蹤中」標註。
**templateParserConfigSchema strict 決策（最終審查遺留）**：維持非 strict（容忍 legacy 多餘欄位、驗證閘門目的為擋格式錯誤而非 key 拼字），於 schema 旁加一行註解記載此決策與理由，關閉追蹤項。
Commit `docs: sync README/CLAUDE.md with post-refactor reality`

---

### Task 15: esun/yuanta parser 決策落地（Plan A Task 13 發現）

**Files:** `apps/server/src/parsers/esun.ts`、`yuanta.ts`、`__tests__/fixtures.ts`（更新對應 expected）

- esun：`esun.ts:32` 的表格 regex 改取**第 3 個數字**（與檔頭註解一致：`TWD 0 69,988 69,988 6,999` 的應繳總額），fixture 改為前期餘額非 0 的變體以具鑑別力（`TWD 5,000 64,988 69,988 6,999` → expected amount 69988）。
- yuanta：程式行為保留（保號，與 LLM 慣例「負數=溢繳」一致、sanityCheck 用 abs 檢查），**修正檔頭註解**移除「取絕對值」的錯誤敘述。

**Steps:** TDD（先改 fixture 為鑑別版 → esun 測試 RED → 修 regex → GREEN）→ 全綠 → commit `fix(parsers): esun takes the documented 3rd table field; align yuanta sign comment`
**行為影響備註（report 必列）**：esun 使用者若前期餘額非 0，修正前解析到的是錯值——此為修 bug 非行為破壞。

---

### Task 16: SSE / 掃描隔離整合測試（MT carry-forward 清償）

**Files:** `apps/server/src/services/__tests__/scan-isolation.test.ts`（新建）

**Steps:** mock provider 注入兩個 user 的 banks/信件，斷言：(a) `scanAndProcessEmails(userA)` 只查 A 的 banks（`prisma.bank.findMany` 的 where 以實際建出的 bill 歸屬驗證，不 mock prisma）；(b) `runScanWithLog` 寫入的 ScanLog.userId 正確；(c) `eventVisibleTo` + snapshot Map：A 的事件對 B 不可見（直接以 bus listener 收集事件驗證）。全綠 + commit `test(server): pin multi-user scan isolation end-to-end`

---

## Plan B 完成定義

- [ ] 全 gates：server tests（預估 ~135+）、shared 11、typecheck 0、`pnpm -r lint` 0、`pnpm --filter @bill-alarm/web generate` 成功、web typecheck 0（B11 之後）。
- [ ] Controller 手動冒煙：dev 起雙服務——banks 頁四互動、設定頁（email verify=1、pdfPassword 遮罩編輯、清除密碼）、儀表板載入不觸發 IMAP、掃描 409 鎖、SSE 進度。
- [ ] 最終全分支審查（最高階模型）＋單一修復波。
- [ ] 部署後人工驗證清單交付使用者：SSE 即時性（nginx buffering 修正）、提醒時刻、ICS 日期、（若設 ENCRYPTION_KEY）secrets 升級加密。
