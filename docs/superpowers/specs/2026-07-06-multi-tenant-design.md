# Bill Alarm — 完全對稱多租戶（每人獨立資料）設計

日期：2026-07-06
狀態：已核准（使用者確認「開始」）

## 背景與目標

多使用者功能（`2026-07-05-user-management-design.md`，已合併 `ee1c4cf`）採「全家共用一份資料＋member 唯讀日常操作」。使用者方向修正：**每個使用者完全獨立** — 各自的信箱、銀行、帳單、通知規則、行事曆訂閱，彼此互不可見；admin 也只看自己的資料，角色僅多「使用者管理＋全域基礎設施設定」。

使用者已確認的決策：

1. **信箱架構**：每人自己的 IMAP 信箱，系統分別掃描
2. **可見性**：完全對稱隔離 — admin 也只看自己的帳單/銀行/紀錄
3. **通知**：帳單通知（新帳單／到期提醒／逾期警告）只發帳單擁有者的 Telegram 綁定
4. 本設計**取代**先前口頭討論的「共用資料＋持卡人標記」方案（該方案未寫入 spec 即作廢）

**推論性簡化**（信箱決定歸屬的紅利）：不需要密碼候選猜持卡人；`Bank` 每人一套資料列後，`@@unique([bankId, billingPeriod])` 去重鍵天然按人隔離，不需修改。

**非目標**：跨使用者共享／委任檢視（連唯讀都沒有）、per-user LLM key、per-user Telegram bot、單一使用者多信箱、家庭彙總報表、共用銀行目錄（catalog + junction 方案已評估並否決 — 隱私模型下「一人調範本全家受益」是反特性，且所有引用點都要雙表 join）、每人獨立 SQLite（部署與備份複雜化，否決）。

## 設計

### 1. 租戶模型（Prisma）

`User` 新增欄位：

```prisma
  imapHost     String?
  imapPort     Int?
  imapUser     String?
  imapPassword String?
  icsFeedToken String?  @unique
  banks             Bank[]
  bankAccounts      BankAccount[]
  notificationRules NotificationRule[]
  scanLogs          ScanLog[]
```

`Bank`、`BankAccount`、`NotificationRule`、`ScanLog` 各加必填 `userId` ＋ relation（`onDelete: Cascade`）。

- **`Bank.code` 的 unique 改為 `@@unique([userId, code])`**（兩人啟用同一個 preset 會撞現有的全域 unique）。
- `Bill` 不加欄位：歸屬經由 `bank.userId`（單一事實來源）；查詢用 `where: { bank: { userId } }`。
- **使用者刪除改三段式（軟刪除）**：`User.deletedAt DateTime?`。
  - **停用**（原「刪除」按鈕）：設 `deletedAt`＋撤銷全部 sessions。資料全數保留。
  - **還原**：清 `deletedAt`，一切如舊。
  - **永久刪除**（僅停用狀態可按，二次確認）：真正 hard delete，cascade 刪除其銀行 → 帳單 → 通知紀錄、規則、掃描紀錄、sessions（schema 的 cascade FK 為此保留）。磁碟上的 PDF 檔不清（homelab 可接受，README 註記）。
  - admin 不可停用也不可刪除（同現行規則）。
  - 停用帳號的 username 仍佔用（可還原）；新建同名帳號回 409。

### 2. 授權模型反轉

`authGuard` 的 `MEMBER_ALLOW`（member 白名單、預設拒絕）**反轉為 `ADMIN_ONLY` 短清單**：非 admin 命中清單回 403，其餘所有已認證路由人人可用，但 **handler 一律以 `getAuthUser(c).id` 限定資料範圍**（行級隔離）。

`ADMIN_ONLY`（method ＋ path pattern）：

- `/api/users` 全部（使用者管理）
- `POST /api/config/llm`、`POST /api/config/gemini`、`POST /api/config/openai`（LLM 全域設定）
- `POST /api/config/telegram`（bot token 全域）
- `POST /api/config/scan`（掃描全域參數：interval／rangeDays／queryExtra 維持全域）
- `GET /api/config/status`（聚合狀態瘦身後只含全域項，見 §6）
- `POST /api/llm/test`（測全域 LLM 連線）

全員可用（各自資料）：帳單 CRUD（含 pay/unpay/reparse/pdf）、銀行與帳戶管理（含 presets 啟用）、信箱設定（test/save/status）、手動掃描＋SSE 進度＋掃描紀錄、通知規則 CRUD、行事曆 info/rotate、parser 工具（test-pdf/test-text/test-template/suggest-rule/bootstrap — 服務自己銀行的範本調校；stateless 端點不涉他人資料；bootstrap 限自己的帳單）、`GET /api/llm/status`（僅布林）、Telegram 綁定、帳號操作。

**跨使用者防護原則**：以 id 存取單一資源的路由（bill/:id、bank/:id、rule/:id…）查無「屬於我的該 id」一律回 404（不回 403，避免資源存在性洩漏）。每條路由配「A 拿不到 B 的資源」測試。

**停用帳號的強制點**：登入時密碼驗證通過但 `deletedAt` 非空 → 401 `{ error: '此帳號已停用' }`（不計入鎖定失敗）；`validateSession` 對 `deletedAt` 非空的使用者一律視為無效（停用當下已撤銷 sessions，此為雙保險）。

### 3. 信箱與掃描

- Email provider 設定從 settings 全域鍵改為 **per-user**（`User.imap*` 欄位）；provider 型別固定 `gmail-imap`（`EMAIL_PROVIDER` 設定鍵與 env 廢除）。`getEmailProvider(user)`、`verifyConnection(user)` 改吃使用者參數。
- `runScanWithLog` 增加 user 參數：只搜該使用者的信箱、只比對該使用者的銀行、`ScanLog.userId` 記錄歸屬。
- 手動掃描（`POST /api/email/scan`）：掃自己的信箱。
- Cron：依序輪掃每個「已設定信箱**且未停用**」的使用者（序列執行，不併發 IMAP）。單一使用者失敗不中斷其他人（per-user try/catch，錯誤記該使用者的 ScanLog）。
- 掃描進度 SSE（`/api/scan-events`）：事件 payload 加 `userId`，路由端以 session 使用者過濾 — 每人只看到自己的掃描進度。
- 掃描全域參數（interval／rangeDays／queryExtra）維持 settings 全域、admin 管理。

### 4. 通知與行事曆

- `telegram.ts`：移除 `broadcast()`（無剩餘消費者），新增 `sendToUser(userId, text): Promise<{ ok: boolean; error?: string }>`（查該使用者 `telegramChatId`，未綁定回 `{ ok: false, error: '使用者未綁定 Telegram' }`，不丟例外）。`sendMessage`／`getBotUsername`／`getUpdates`／`sendTestMessage`／`isConfigured` 不變。三個通知函式簽名維持 `(bill, bank)`，訊息文字逐字保留，內部從 `broadcast(text)` 改為 `sendToUser(bank.userId, text)`，回傳 `{ ok, error? }`。
- `notification.ts`：
  - `processNewBill(bill, bank)` → `sendToUser(bank.userId, …)`；NotificationLog 一則一列，未綁定記 `success=false` ＋原因。
  - `processReminderRules()` → 迭代所有規則（含 `userId`），每條規則只撈**該使用者**的到期帳單（`bank: { userId: rule.userId }`），發給該使用者。
  - `processOverdueBills()` → 逐帳單發給 `bank.userId`。
- 通知規則 per-user：每人建立、管理自己的規則；現有規則遷移歸 admin。
- **停用者靜默**：提醒／逾期迴圈跳過停用使用者的規則與帳單 — 不發通知、不寫通知 log；逾期「狀態標記」照常執行（資料事實不因停用而失真）。
- 行事曆 feed per-user：`GET /api/calendar/feed/:token.ics` 以 `icsFeedToken` 反查**未停用**使用者，只輸出該使用者的帳單（停用者的 token 回 404）；`/info`／`/rotate` 操作自己的 token（無則自動產生）。現有全域 `ics_feed_token` 遷移為 admin 的 token — **admin 現有的行事曆訂閱連結不會斷**。

### 5. 遷移（手寫 SQL，一次）

1. `users` 加五欄＋`icsFeedToken` unique index。
2. `banks`／`bank_accounts`／`notification_rules`／`scan_logs` 重建加 `userId TEXT NOT NULL` ＋ FK cascade，既有資料全部回填 admin（`SELECT id FROM users WHERE role='admin' LIMIT 1`）；`banks` 舊的 `code` 全域 unique index 換成 `(userId, code)` 複合 unique。
3. settings 搬移到 admin 的 User 列：`imap_host`／`imap_port`／`imap_user`／`imap_password` → `imap*` 欄位；`ics_feed_token` → `icsFeedToken`；搬完刪除這些 key ＋ `email_provider`。
4. `ENV_MAP` 移除 `IMAP_HOST`／`IMAP_PORT`／`IMAP_USER`／`IMAP_PASSWORD`／`EMAIL_PROVIDER`（信箱只能在 UI 各自設定；README 升級註記）。
5. **sessions 不清空 — 這次升級不用重新登入。**
6. 邊角：若 DB 無 admin（全新安裝從未 setup），回填的 SELECT 為 NULL — 但此時這些表必為空，回填無資料可動，安全。

### 6. API 形狀調整

- `GET /api/config/status` 瘦身為全域項（llm／gemini／openai／telegram bot ＋ boundCount／scan 參數／appBaseUrl）— email 與 calendar 區塊移除（改由 per-user 端點：`GET /api/email/status`、`GET /api/calendar/info`）。
- `GET /api/email/status`＋`GET /api/integrations/status`：回報**當前使用者**的信箱連線狀態（telegram 部分維持 bot token 布林）。
- `POST /api/email/save`／`test`：寫入／測試當前使用者的 imap 欄位。
- users API：`DELETE /api/users/:id` → **停用**（設 deletedAt＋撤 sessions；admin 目標回 400）；新增 `POST /api/users/:id/restore`（還原）與 `DELETE /api/users/:id/permanent`（僅停用狀態可執行，否則 400；hard cascade）。DTO 增加 `emailConfigured: boolean` 與 `deletedAt: string | null`。

### 7. 前端

- **導航**：五個 tab 全員可見（`useNavItems` 移除 member 過濾）。
- **帳單頁**：移除上一輪的 `isAdmin` gating — 編輯／刪除／AI 重解析對所有人開放（都是自己的帳單）。
- **銀行頁**：全員可用（自己的銀行、presets 啟用、PDF 密碼、範本編輯）。
- **設定頁 v3**（人人同構＋admin 附加）：
  - 服務整合（全員）：信箱卡（自己的 IMAP；掃描全域參數區塊移出）、行事曆卡（自己的 feed＋rotate）
  - 通知規則（全員，自己的）
  - 帳號（全員）：安裝 App、Telegram 綁定、帳號卡（改密碼／登出）
  - admin 附加區「系統管理」：AI 解析器卡、Telegram Bot 卡（token＋boundCount＋發測試）、掃描全域參數卡（從信箱卡抽出）、使用者管理卡（成員列顯示「信箱已設定」與啟用狀態；啟用中→［重設密碼／停用］，已停用→標示「已停用」＋［還原／永久刪除（二次確認，警語明示連帳單一起刪）］）
- 資料來源：全員區塊全部走 per-user 端點；admin 附加區走 `config/status`（admin-only）。member 造訪設定頁零 admin-only 呼叫（沿用上一輪的 isAdmin 守門模式）。
- 首次上手（成員第一次登入）：總覽空狀態引導文案「先到 設定 → 信箱 完成設定，再到 銀行 啟用你的銀行」。

### 8. 測試

- **跨使用者隔離矩陣**（新測試檔）：兩個使用者各建資料，逐路由驗證 A 對 B 的資源 404／列表過濾不可見（bills list/detail/pdf/pay/unpay/reparse、banks CRUD、bank-accounts、rules、scan-logs、calendar feed token 互換、parser/bootstrap）。
- ADMIN_ONLY 清單：member 對 users/config/llm-test 403；admin 通過。
- 掃描分流：mock provider 下兩使用者各自銀行比對、ScanLog 歸屬、單人失敗不斷全局。
- 通知：規則只撈自己人的帳單、`sendToUser` 未綁定記失敗。
- 行事曆：token 只回自己帳單、rotate 只換自己的。
- 停用生命週期：停用後登入 401（不計鎖定）、既有 session 失效、cron 跳過、通知靜默、feed 404；還原後全部恢復；永久刪除 cascade 清空其資料；非停用狀態按永久刪除回 400。
- 遷移：seed 舊型 DB 驗證回填與 settings 搬移；sessions 保留。
- 全套既有測試改寫適配（role-guard 測試矩陣重寫為新模型）。`pnpm --filter @bill-alarm/web generate` 通過。

## 驗收

- 太太登入自己帳號 → 設定自己的 Gmail → 啟用她的銀行＋設她的 PDF 密碼 → 掃描 → 她的帳單只在她帳號出現、到期提醒只發她的 Telegram、行事曆訂閱只含她的帳單。
- 你的帳號：既有帳單／銀行／信箱設定／通知規則／行事曆訂閱完整保留且只有你看得到；**升級後不需重新登入**、行事曆訂閱連結不斷。
- 任一使用者以 API 直接嘗試存取他人資源 → 404 或列表不可見；member 碰全域設定 → 403。
- admin 設定頁多出系統管理區；成員設定頁完整自助（信箱／銀行／規則／行事曆／TG）。

## 部署注意

- 若信箱原以 `IMAP_*` env 設定：env 不再讀取，升級後到 設定 → 信箱 重新填寫（遷移只搬 DB 內的設定值）。
- README 更新：多租戶行為、env 廢除清單、刪除使用者連同其資料刪除。
- `.claude/CLAUDE.md` 的「Single-user auth」慣例描述已過時，一併更新。
