# Health Report 修復案 — 設計規格

> 日期：2026-07-09 ・ 分支：`refactor/health-report-fixes`
> 問題來源：`docs/improvement-report.md`（v0.3.4 健檢報告），本文件引用其編號（如 2.1、3.5）。
> 範圍：報告路線圖**全部三批**。

## 0. 已拍板的方向性決策（使用者確認）

| 決策點 | 結論 |
|--------|------|
| 範圍 | 全部三批（快贏＋結構收斂＋長期項） |
| `timeOfDay`（2.1） | **實作**：每 15 分鐘 tick + 時間窗比對 |
| generic parser（3.1） | **徹底移除**：程式碼與行為對齊「寧可 LLM 也不 regex 猜」 |
| 日期/時區（2.3） | **根治**：`dueDate` 改存 `YYYY-MM-DD` 字串 |
| Email 抽象（3.2） | 修正抽象（結構化 SearchOptions），不鎖 Gmail-only |
| `sourceEmailId` | **維持 IMAP UID**，不換 Message-ID（避免既有去重失效） |
| pdfPassword UX | 列表遮罩；編輯「留空＝不變」＋「清除密碼」按鈕 |
| 逾期通知時刻 | 標記逾期隨 tick 即時；Telegram 警告延到當天 09:00 後第一個 tick |

## 1. 日期根治：`dueDate` → `YYYY-MM-DD` 字串

### Schema

- `Bill.dueDate`：`DateTime` → `String`（值恆為 `YYYY-MM-DD`）。
- `Bill.paidAt` 維持 `DateTime`（事件時間戳，僅顯示用，無日界計算）。

### 資料轉換（migration 內的 SQL）

既有值一律以 **+8 小時（Asia/Taipei）** 位移後取日期部分。理由——三種歷史寫入路徑在 +8h 轉換下全部得出正確的台北日曆日：

| 歷史寫入路徑 | 儲存值（例：帳面日 7/10） | +8h 後取日期 |
|--------------|---------------------------|--------------|
| parser（prod, TZ=UTC） | `2026-07-10T00:00Z` | 7/10 ✓ |
| LLM（`new Date('YYYY-MM-DD')`） | `2026-07-10T00:00Z` | 7/10 ✓ |
| 前端編輯（台北瀏覽器） | `2026-07-09T16:00Z` | 7/10 ✓ |
| dev 伺服器（台北本地） | `2026-07-09T16:00Z` | 7/10 ✓ |

實作註記：migration 前先確認 Prisma + better-sqlite3 adapter 的 DateTime 實際儲存格式（TEXT ISO 或 epoch 數值），據此寫 `strftime`/`datetime(..., '+8 hours')` 轉換 SQL；SQLite 改型別本來就是 table rebuild，轉換與重建在同一個 migration 完成。

### 讀寫規範

- shared 新增 `date.ts`（單一事實來源）：
  - `todayYMD(): string`
  - `addDaysYMD(ymd, days): string`
  - `daysUntil(ymd): number`（以本地「今天」為基準）
  - `formatYMD(ymd): string`（`YYYY/MM/DD` 顯示格式）
  - `deriveBillingPeriod(ymd): string`（純年月運算，**修復 2.2 的 setMonth 溢位**；`llm-parser.ts` 內的私有實作刪除、改用這份）
  - `ymdFromParts(year, month, day): string | null`（含 ROC 年轉換與範圍檢查，取代 parsers/utils 的 `parseDate` 回 Date 的行為）
- parser 端（template/hardcoded/LLM）的 `ParsedBill.dueDate` 型別由 `Date` 改為 `string`（YMD）。
- API：`PATCH /api/bills/:id` 與 pay 端點的日期欄位改收 `YYYY-MM-DD`（zod regex）；回應中的 `dueDate` 自然變成該字串。
- 查詢：範圍/排序全部走字串比較（`gte`/`lt`/`orderBy` 對 `YYYY-MM-DD` 字典序即日期序）；`duplicateBillExists` 的相等比對改字串（比 timestamp 相等更穩）。
- `sanityCheck` 的 ±90 天：解析 YMD 成 Date 後計算，僅此處需要 Date。
- ICS feed：直接拆字串組 `DateArray`，不再經過 UTC getter。
- 前端：`new Date(bill.dueDate)` 全部改走 shared `daysUntil`/`formatYMD`（字串進、字串出，不經 Date 的時區語意）。

### 時區

- Dockerfile 加 `ENV TZ=Asia/Taipei`；兩個 `cron.schedule` 傳 `timezone: 'Asia/Taipei'`。
- 目的：cron 觸發時刻、Telegram 顯示、`todayYMD()` 的「今天」與使用者一致。dueDate 本身已與時區脫鉤。

## 2. timeOfDay 實作與逾期通知

- 提醒 cron：`5 0 * * *` → `*/15 * * * *`。
- 每 tick 對每條 active 規則：
  - 觸發條件：`now >= 今天的 rule.timeOfDay` **且** 該 (rule, bill) 今天沒有成功發送紀錄（沿用 `alreadySent` 查詢）。
  - 目標帳單：`dueDate === addDaysYMD(todayYMD(), rule.daysBefore)`（字串相等，取代現行 gte/lt 窗）。
  - 語意特性（皆為刻意）：伺服器在設定時刻停機 → 下一個 tick 補發（自癒）；掃描在設定時刻之後才建立的帳單 → 當天稍晚的 tick 仍會提醒。
- 逾期處理拆分：
  - **標記**：每 tick 將 `status=PENDING && dueDate < todayYMD()` 批次改為 OVERDUE（可用 `updateMany`）。
  - **通知**：每張帳單一生只發一次逾期警告；發送條件為當前時刻 ≥ 09:00 且該帳單無成功的逾期警告紀錄。去重依據 `NotificationLog`（billId + channel telegram + message 常數 `OVERDUE_WARNING_MESSAGE` + success）。message 字串定義為常數，禁止散落字面值。
  - 與現行語意對照：現行也是每帳單一次，但發送於 00:05；新制改到 09:00 後，不半夜打擾。
- 信箱掃描排程（每小時 + interval 節流）不變。

## 3. 解析鏈統一 + generic 移除

- 新增 `apps/server/src/services/bill-parser.ts`：

  ```ts
  type ParseSource = 'template' | 'hardcoded' | 'llm'
  interface ParseOutcome {
    bill: ParsedBill | null
    source: ParseSource | null
    attempts: Array<{ source: ParseSource; error: string }>  // 各層失敗原因，供 ScanError / Parser Lab 顯示
  }
  parseBill(text: string, bank: { code: string | null; name: string; parserConfig: string | null },
            opts: { allowLlm: boolean }): Promise<ParseOutcome>
  ```

  鏈：template（有 parserConfig 時）→ hardcoded → LLM（`allowLlm && provider !== None`）。
- 呼叫端：`scanAndProcessEmails`（allowLlm: true）與 Parser Lab 的 `test-pdf`/`test-text`（allowLlm 依請求 flag）都改走它。`bill-extractor.ts` 刪除、`registry.parseText`/`getParser`（generic fallback）刪除，registry 只留 `getHardcodedParser`/`listParserCodes`。
- 刪除 `parsers/generic.ts`；`/api/parser/list` 回應移除 `fallback: 'generic'`。
- `parseSource` 舊值容忍：DB 既有 `'generic'` 資料列不動；前端 `parseSourceLabel/Icon/Class` 保留 `'generic'` 顯示分支（標註 legacy）；shared 的寫入側型別（`ParseSource`）不含 `'generic'`，`BillDTO.parseSource` 讀取側聯集保留它。
- `Bank.parserConfig` 寫入驗證（4.3）：`TemplateParserConfig` 的 zod schema 從 `system.ts` 移到 shared，`PATCH /api/banks/:id` 收到 `parserConfig` 字串時 parse + 驗證，不合法回 400。掃描時 template 層失敗改記入 `attempts`（進 ScanError），不再只留 server log。

## 4. Schema migration（與第 1 節同批或相鄰 migration）

- 刪除 `Bill.calendarEventId`。
- `Bill.bank`、`NotificationLog.bill` 加 `onDelete: Cascade`；`NotificationLog.rule` 明寫 `onDelete: SetNull`。
- 連動簡化：`DELETE /api/bills/:id` 刪除手動 `notificationLog.deleteMany`；`users.ts` permanent delete 的 transaction 縮為 `prisma.user.delete()` 一句（user→bank→bill→log 全鏈 cascade；scanLog/rule/account/session 原本就 cascade）。
- 索引：`bills @@index([status, dueDate])`、`bills @@index([bankId])`、`sessions @@index([expiresAt])`。
- `NotificationRule.channels` 的 zod enum 收斂為 `['telegram']`；DB 舊資料含 `'calendar'` 者維持靜默跳過（處理迴圈行為不變）。
- `DELETE /api/banks/:id` 補前置檢查：有帳單時回 400「此銀行尚有 N 筆帳單」（cascade 在但刻意不讓使用者一鍵連鎖刪除帳單）。

## 5. Email 抽象修正

- `SearchOptions` 改為結構化：`{ senders: string[]; sinceDays: number; hasAttachment: boolean }`，Gmail 語法字串不再出現在呼叫端（`email-parser.ts` 不再拼 `from:(...) OR ...`）。
- `GmailImapProvider.search` 依 host 翻譯：
  - host 為 `imap.gmail.com`（或 `*.gmail.com`）→ 現行 `gmailraw` 快路徑，並附加全域設定 `SCAN_GMAIL_QUERY_EXTRA`。
  - 其他 host → 標準 IMAP `SEARCH`：`SINCE <date>` + n-ary OR 的 `FROM`（imapflow 查詢物件；實作時查證 imapflow 的 `or` 是否支援 >2 元素，不支援則自行巢狀）。`hasAttachment` 無標準對應 → 忽略（既有流程本來就以 PDF 附件後過濾）。
  - 非 Gmail host 時 `SCAN_GMAIL_QUERY_EXTRA` 不適用：略過並在掃描 log 記一行提示。
- debug 路由 `/api/email/search` 的自由字串 query **保留不動**，僅在回應與註解標明為 Gmail-only debug 工具。
- `sourceEmailId` 維持 UID；`SearchOptions.sinceDays` 從此真正被 provider 使用（half-dead 參數復活）。

## 6. 安全與強化

- **pdfPassword 遮罩（5.1）**：
  - `GET /api/banks` 改為顯式 select/map，移除 `pdfPassword`，新增 `hasPdfPassword: boolean`。`parserConfig` 保留（editor 需要）。
  - `PATCH /api/banks/:id` 的 `pdfPassword` 語意：欄位缺席或空字串 → 不變；`null` → 清除；非空字串 → 覆寫。
  - `POST /api/banks/enable/:code` 對既有 record 重新啟用時，若 body 帶 `pdfPassword` 則一併更新（修 2.8）。
  - 前端編輯 dialog：密碼欄 placeholder 依 `hasPdfPassword` 顯示「已設定（留空維持不變）」/「未設定」；新增「清除密碼」動作（送 `null`）。
- **Secrets at-rest 加密（5.1 進階）**：新增 `services/secrets.ts`：
  - AES-256-GCM；金鑰 = SHA-256(`ENCRYPTION_KEY` env)；密文格式 `enc:v1:<b64(iv)>:<b64(ct||tag)>`。
  - `decryptSecret(value)`：無 `enc:v1:` 前綴視為明碼原樣回傳（向下相容）；`encryptSecret(value)`：有金鑰才加密，否則原樣。
  - 覆蓋範圍：`User.imapPassword`、`Bank.pdfPassword`、Settings 的 `telegram_bot_token`/`gemini_api_key`/`openai_api_key`（settings service 內建 per-key 的加密名單，`getSetting`/`setSetting` 透明處理；imap/pdf 密碼在讀寫點以 helper 包裝）。
  - 未設 `ENCRYPTION_KEY`：維持明碼，開機 log warn 一次。既有明碼值在下次寫入時自然升級為密文（不做一次性資料 migration）。
- **全域**：`app.onError`（pino error log + `{ error }` JSON，500 訊息不洩內部細節）；全域 `bodyLimit` 25MB（auth 子路由維持 16KB）；移除 `app.use('/api/*', cors())`；`scryptSync` → async `scrypt`（`hashPassword`/`verifyPassword` 轉 async，呼叫點與測試同步修）。
- **掃描併發（2.5）**：scan service 模組層 `Set<userId>` 鎖；`runScanWithLog` 進出（finally 釋放）；`POST /api/email/scan` 撞鎖回 409 `{ error: '掃描進行中' }`；cron 撞鎖跳過該使用者並 log。SSE snapshot 改 `Map<userId, ScanSnapshot>`，complete 時刪 key。
- **SSE buffering（2.4）**：SSE handler 補 `X-Accel-Buffering: no` header；nginx `/api/scan-events` location 設 `proxy_buffering off; proxy_read_timeout 1h;`。部署後人工驗證進度即時性。
- **LLM timeout（6.2）**：三個 provider 統一 60 秒（fetch 用 `AbortSignal.timeout`；Gemini SDK 查其 timeout 選項，無則以既有 `withTimeout` 包裝——`withTimeout` 從 pdf-parser 移到共用 util）。
- **Email status 輕量化（6.1）**：`GET /api/email/status` 預設只回 DB 欄位（`hasCredentials/host/port/user`）；`?verify=1` 才做 IMAP 連線並附 `connected/message/email`。儀表板 mount 用預設版；設定頁用 `verify=1`。`/api/integrations/status` 不變（僅設定頁使用）。
- **sanity 警告透傳（2.7）**：`ScanResult.newBills` 元素加 `warning?: string`；`processNewBill(bill, bank, warning?)` 在 Telegram 新帳單訊息附加「⚠️ 解析結果異常（原因），請核對後再繳費」。建立帳單的行為維持（仍建立），只是通知不再沉默。
- **bills 狀態轉移一致化（2.8）**：`PATCH /api/bills/:id` 若 status 轉為 PAID 且未帶 paidAt → `paidAt = now`；由 PAID 轉出 → `paidAt = null`。pay/unpay 端點行為不變，三處共用同一小 helper。
- **setup race 補強**：`POST /api/auth/setup` 對 `prisma.user.create` 加 P2002 catch 回 403（與現行 count 檢查同語意）。
- 明確不做：per-IP 登入限流（CF Access 前置）、`/api/email/test` host allowlist（家庭環境，僅在 README 提示風險）。

## 7. 路由重組與權限（URL 一律不變）

- `routes/system.ts` 拆為：
  - `routes/scan.ts`：`POST /email/scan`、`GET /scan-events`、`GET /scan-logs`
  - `routes/parser-lab.ts`：`/parser/*`、`GET /email/search`、`GET /email/message/*`
  - `routes/llm.ts`：`/llm/*`
  - `routes/integrations.ts`：`GET /integrations/status`、`POST /telegram/test`
  - 掛載方式維持 `app.route('/api', …)`，路徑零變動。
- `routes/settings.ts` → `routes/notification-rules.ts`（純改名）。
- `ADMIN_ONLY` regex 清單刪除，改 `middleware/admin-only.ts` 匯出 `adminOnly`（讀 `authUser.role`，非 admin 回 403）：
  - `users.ts`：`app.use('*', adminOnly)`
  - `config.ts`：POST 各端點與 `GET /status` 掛 per-route
  - `llm.ts`：`POST /test` 掛 per-route（`/status`、`/suggest-rule` 維持 member 可用）
  - 權限語意與現狀完全相同，`role-guard.test.ts` 不改測試內容、必須全綠。
- `telegram.ts` 的 `console.*` → pino logger。

## 8. 前端收斂

- **shared 型別**：`ScanEvent`/`ScanSnapshot` 基底、`ScanError`/`ScanErrorStage`/`ScanLogDTO` 移入 `packages/shared/scan.ts`；server 端以交集型別附加 `userId`；web 的重複宣告刪除改 import。
- **shared 格式化**：`packages/shared/format.ts`：`formatAmount`、`formatYMD`、`daysUntil`、`daysRemainingInfo(ymd, status): { text, tone }`（tone → class 對映留在 web）。telegram.ts / calendar-feed.ts / 三個頁面全部改用。
- **`<DaysRemaining>` 元件**取代 `index.vue` 的 inline `defineComponent` 與 `[id].vue` 的 computed 重複。
- **composables 去 any**：`useBillApi`/`useSettingsApi` 等以 shared DTO 標型別；DTO 依現行 API 回應形狀對齊（`BillDTO` 補 `bank.autoDebit/isActive/code` 等實際回傳欄位；banks 列表新增 `BankDTO`，內含 `hasPdfPassword`）。
- **banks 頁拆分**：`components/banks/PresetBankSection.vue`、`CustomBankSection.vue`、`BankAccountSection.vue` + 各自 dialog；頁面剩組裝與資料抓取。行為與樣式不變；順手修 3.6 提到的 Switch handler 無 catch。
- **`bills/[id].vue` 不拆**（YAGNI，本次明確不做）。
- 依賴清理：移除 `radix-vue`。

## 9. 死碼與文件

- 刪除：`DEFAULT_NOTIFICATION_RULES`、`NOTIFICATION_CHANNEL_LABELS`、`TEMPLATE_PRESETS`（五家皆有 hardcoded parser，冗餘）、`getMultiple()`、`getPdfBuffers` 的 `zipPassword` 參數、`package.json` 的 `db:seed` script、`useScanEvents` 的過時註解、`pdf-parser.ts` 的誤導註解。
- `scripts/email-pdf-extract.ts`：改用 `getEmailProviderFor`（從 env 或參數收 IMAP 帳密）修復壞 import；`--file` 模式不受影響。
- README：compose 範例 port 對映改 `:80`；Gmail API/OAuth/Google Calendar 敘述改為 per-user IMAP + ICS feed + Telegram；銀行表補 `hsbc_tw`/`chb`/`fubon`；LLM 敘述改三 provider；補 `ENCRYPTION_KEY`、`TZ` 說明。
- CLAUDE.md：`src/db/` 修正為 `prisma/` + `src/prisma.ts`；通知/信箱敘述同步；補「dueDate 為 YYYY-MM-DD 字串」與「adminOnly middleware」慣例。
- `docs/improvement-report.md` 隨修復進度在對應項目標註已處理（最後一個 phase 統一標）。

## 10. 測試與 CI

- **CI（最先做，作為全案護欄）**：`.github/workflows/test.yml`，PR + push main 觸發：pnpm install（frozen lockfile）→ server vitest → web/server eslint。`build.yml` 不動。
- server 補 eslint flat config（typescript-eslint recommended + stylistic：no-semi/single-quote，與 web 風格一致），`lint` script 接進 turbo。
- 新增測試：
  - `shared/date.ts` 全函式（ROC 年、月底 29-31 溢位回歸、跨年）
  - timeOfDay 觸發窗與 alreadySent 去重、逾期標記/通知拆分
  - `parseBill` 鏈序與 attempts 回報
  - 各 hardcoded parser 的合成 fixture（依各檔註解記載的格式特徵構造去識別化文字，快照其解析結果）
  - secrets encrypt/decrypt 往返與明碼相容
  - dueDate migration 轉換規則（以 SQL 或 helper 層驗證 +8h 規則）
- 既有 14 個測試檔全綠為每個 phase 的完成條件。

## 11. 實作順序（phase 劃分，交給 implementation plan 細化）

1. CI + server eslint（護欄先行）
2. shared 基礎：`date.ts`、`format.ts`、scan 型別搬遷（無行為變更）
3. **Schema migration**：dueDate 字串化＋資料轉換＋cascade＋索引＋刪 calendarEventId，同步修全部讀寫點（最大、需一氣呵成的 phase）
4. 解析鏈統一、generic 移除、parserConfig 寫入驗證
5. 排程與通知：timeOfDay、逾期拆分、sanity 警告、TZ 固定
6. 路由與強化：onError、bodyLimit、cors、adminOnly、拆檔改名、掃描鎖、SSE 修正、async scrypt、LLM timeout、email status 輕量化、bills/banks 行為修正、pdfPassword 遮罩
7. Email 抽象修正
8. Secrets 加密
9. 前端收斂（型別、格式化、DaysRemaining、banks 拆分、依賴清理）
10. 文件、死碼收尾、報告標註

每 phase 結束：測試全綠 → conventional commit。全案完成後由使用者決定 merge 方式。

## 12. 成功準則

- 既有測試全數通過（`role-guard`、`tenant-isolation` 等內容不修改）。
- 所有 API URL 與回應語意不變（除本文件明列者：banks 列表的 pdfPassword→hasPdfPassword、email/status 預設不驗連線、日期欄位格式）。
- 新增測試覆蓋本文件第 10 節清單。
- `pnpm dev` 手動煙霧測試：登入 → 儀表板 → 帳單編輯（日期）→ 銀行編輯（密碼遮罩）→ 手動掃描（含 409 鎖）→ 通知規則 CRUD。
- 正式部署後人工驗證：SSE 進度即時、提醒於設定時刻送達、ICS 日期正確。
