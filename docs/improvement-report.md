# Bill Alarm 專案健檢報告

> 產出日期：2026-07-08 ・ 基準版本：v0.3.4（main @ d209140）
> 範圍：apps/server、apps/web、packages/shared、部署設定（Dockerfile / docker-compose / nginx / CI）
> 方法：逐檔閱讀全部原始碼（約 8–10k 行，排除 generated code 與 shadcn-vue components），每項發現皆附檔案位置；未經驗證的推測會明確標註。

> **更新（v0.4，2026-07）：** 本報告的多數發現已在兩輪 refactor 中處理完畢，詳見 [`docs/superpowers/plans/2026-07-09-health-fixes-plan-a.md`](superpowers/plans/2026-07-09-health-fixes-plan-a.md) 與 [`plan-b.md`](superpowers/plans/2026-07-09-health-fixes-plan-b.md)。以下各節標題後已標註目前狀態（逐項對照程式碼與 git log 驗證後標註）：✅ 已於 v0.4 處理・🟡 部分已處理・➡️ 追蹤中（尚未處理或刻意延後）。

---

## 目錄

1. [總評與優點](#1-總評與優點)
2. [正確性問題（Bugs）](#2-正確性問題bugs)
3. [架構與抽象設計](#3-架構與抽象設計)
4. [資料結構設計](#4-資料結構設計)
5. [安全性](#5-安全性)
6. [效能](#6-效能)
7. [測試與 CI](#7-測試與-ci)
8. [文件與死程式碼](#8-文件與死程式碼)
9. [建議路線圖](#9-建議路線圖)

---

## 1. 總評與優點

整體而言這是一個結構清楚、品質高於平均自架專案的 codebase。先列出做得好的地方（後面的問題清單很長，但多數是小項，不代表整體品質差）：

- **多租戶隔離做得紮實**：每條資料路由都透過 `getAuthUser(c).id` 自我限縮（如 `bills.ts` 的 `ownBill()`），並有 `tenant-isolation.test.ts` 護欄。
- **認證細節到位**：session token 只存 SHA-256 hash、scrypt + `timingSafeEqual`、per-username lockout（含記憶體上限與防驅逐設計）、cookie `httpOnly/secure/lax`、pino redact cookie、auth 路由有 16KB body limit。停用帳號的各種邊界（登入、通知、cron）都有處理。
- **掃描管線的錯誤處理成熟**：`ScanError` 有結構化 stage、每封信獨立 try/catch、ScanLog 持久化、SSE 即時進度＋snapshot 重播、通知失敗會 append 回 log。
- **金額用整數 NTD 儲存**，避免浮點數問題；`sanityCheck()` 防 LLM 幻覺的思路正確。
- **測試覆蓋關鍵風險區**（auth flow、tenant isolation、role guard、dedup、通知擁有權），而不是撒在低價值處。
- 程式碼中的註解多在解釋「為什麼」（如 lockout 驅逐策略、409 race 處理），品質好。

問題主要集中在三類：**(a) 資料模型與實作脫鉤**（欄位存在但邏輯沒實作）、**(b) 同一邏輯多處實作造成分歧**（其中一份修了 bug、另一份沒修）、**(c) 文件/設定與現況脫節**。

### 嚴重度速查表

| # | 問題 | 嚴重度 | 分類 |
|---|------|--------|------|
| 2.1 | `timeOfDay` 欄位完全未生效，提醒固定 00:05 發送 | 高 | 正確性 |
| 2.2 | `deriveBillingPeriod` 月底日期溢位（重複實作分歧） | 高 | 正確性 |
| 2.3 | 日期以 timestamp 儲存＋時區未固定，多處日界計算互相矛盾 | 高 | 正確性 |
| 2.4 | nginx 未關 SSE buffering，正式環境掃描進度恐延遲 | 中 | 正確性 |
| 2.5 | 同一使用者可併發掃描；SSE snapshot 全域單槽 | 中 | 正確性 |
| 2.6 | 刪除有帳單的銀行 → FK Restrict → 裸 500 | 中 | 正確性 |
| 2.7 | sanity check 失敗仍建帳單並照發正常通知 | 中 | 正確性 |
| 3.1 | 解析鏈雙軌實作：generic parser 在正式掃描中永遠不執行 | 高 | 架構 |
| 3.2 | EmailProvider 抽象洩漏 Gmail 專屬語法，非 Gmail IMAP 必掛 | 高 | 架構 |
| 5.1 | 各種密碼/金鑰明碼存 DB，`GET /api/banks` 回傳 pdfPassword | 中 | 安全 |
| 7.1 | CI 完全沒跑測試與 lint | 中 | CI |
| 8.x | README/CLAUDE.md 過時、多個死 export 與壞腳本 | 低-中 | 文件 |

---

## 2. 正確性問題（Bugs）

### 2.1 `NotificationRule.timeOfDay` 完全沒有作用（高）— ✅ 已於 v0.4 處理

資料流是完整的——UI 有 time picker（`NotificationRuleDialog.vue:105-106`）、zod 驗證格式（`routes/settings.ts:12`）、存進 DB、列表還顯示「於 {{ rule.timeOfDay }} 發送通知」（`NotificationRuleList.vue:83`）——**但排程端從未讀取這個欄位**：

- `scheduler.ts:83`：提醒固定在 cron `5 0 * * *`（伺服器時間 00:05）跑一次。
- `notification.ts:45-100`（`processReminderRules`）：整個函式沒有出現 `timeOfDay`。

使用者設定「09:00 提醒」，實際上在 00:05 收到（容器未設 TZ 時是 UTC 00:05 = 台北 08:05，見 2.3）。這是「UI 承諾了、後端沒實作」的典型欄位，比沒有這個欄位更糟——使用者會以為壞掉。

**建議**（擇一）：
1. 實作它：cron 改成每 15 分鐘跑一次，`processReminderRules` 比對 `timeOfDay` 是否落在目前時間窗，dedup 查詢已經存在（`alreadySent`），天然防重發。
2. 砍掉它：移除欄位、UI、驗證，文件寫明「每日固定於早上發送」。

### 2.2 `deriveBillingPeriod()` 月底日期溢位（高）— ✅ 已於 v0.4 處理

`parsers/utils.ts:43-47`：

```ts
export function deriveBillingPeriod(dueDate: Date): string {
  const d = new Date(dueDate)
  d.setMonth(d.getMonth() - 1)   // ← 溢位
  ...
}
```

`setMonth` 遇到月底會 rollover：dueDate 為 5/31 → `setMonth(3)` 得到「4/31」→ 自動變成 5/1，billingPeriod 算出 `2026-05` 而非預期的 `2026-04`；3/29–3/31 也會因 2 月溢位出錯。信用卡繳款日落在 29–31 號並不罕見。

決定性的證據是 **`llm-parser.ts:234-239` 已經修過完全相同的 bug**，註解明寫「month arithmetic only, so end-of-month dates (29-31) can't overflow」——但只修在 LLM 這一份，template/hardcoded/generic parser 用的 `utils.ts` 那一份沒修。這正是同一邏輯兩份實作的代價（見 3.1）。

由於 `billingPeriod` 參與 `@@unique([bankId, billingPeriod])` 去重，算錯月份可能造成同一期帳單重複入庫或不同期被誤判重複。

**建議**：把 llm-parser 內那段正確的推導抽成 shared helper，兩邊共用；補上 29/30/31 號的單元測試。

### 2.3 日期本質是「日曆日」卻以 timestamp 儲存，時區未固定（高）— ✅ 已於 v0.4 處理

`dueDate` 概念上是「2026-07-10 這一天」，但實際以 `DateTime` 存放，而產生它的路徑各自用不同時區語意：

| 來源 | 寫入方式 | 語意 |
|------|----------|------|
| regex/template parser | `new Date(year, month-1, day)`（`parsers/utils.ts:54`） | **伺服器本地時區** 00:00 |
| LLM parser | `new Date('YYYY-MM-DD')`（`llm-parser.ts:226`） | **UTC** 00:00 |
| 前端編輯 | `new Date(dueDate + 'T00:00:00').toISOString()`（`bills/[id].vue:463`） | **瀏覽器本地時區** 00:00 → 轉 UTC |

消費端同樣分歧：Telegram 的 `daysUntil`/`formatDate` 用本地 getter（`telegram.ts:110-120`）、ICS feed 用 UTC getter（`calendar-feed.ts:14-16`）、提醒規則用伺服器本地午夜切日（`notification.ts:50-63`）、debug 路由用 `toISOString().split('T')[0]`（UTC 切日）。

具體後果（Docker 未設 `TZ`，容器跑 UTC；使用者在台北 UTC+8）：

- **前端編輯過的帳單會提早一天進入提醒視窗**：台北使用者編輯 dueDate 7/10 → 存成 `2026-07-09T16:00Z` → 伺服器 UTC 日界把它歸在 7/9，「到期日提醒」提早一天發；而 parser 建立的同日帳單存 `2026-07-10T00:00Z`，歸在 7/10。同一天到期的兩張帳單，行為不同。
- **dev（macOS 台北時區）與 prod（UTC）行為不一致**：`deriveBillingPeriod`、sanity check 的 ±90 天、逾期判定都會在邊界差一天，本機測不出正式環境的問題。
- 若未來有人在 compose 加上 `TZ=Asia/Taipei`，ICS feed 的日期（UTC getter）反而會倒退一天。

**建議**：一次到位的修法是把 `dueDate`（和 `paidAt` 的日期部分）改成 **date-only 字串 `YYYY-MM-DD`**，所有日界計算走字串比較，顯示層各自 format；成本較低的修法是：(1) Dockerfile 固定 `ENV TZ=Asia/Taipei`（並在 `cron.schedule` 傳 `timezone` 選項），(2) 規定「dueDate 一律為 UTC 午夜」，收斂三個寫入路徑到同一個 shared helper。無論選哪條，**先把寫入路徑統一**，再處理顯示。

### 2.4 nginx 沒為 SSE 關閉 proxy buffering（中）— ✅ 已於 v0.4 處理

`nginx.conf:12-20` 的 `/api/` proxy 沒有 `proxy_buffering off`，而 Hono 的 `streamSSE` 只設 `Content-Type: text/event-stream`，不會送 `X-Accel-Buffering: no`（已翻 `hono@4.12.9` 原始碼確認）。nginx 預設 `proxy_buffering on`，SSE 事件很可能被緩衝、進度條在正式環境不即時甚至整批到達——dev 環境走 Nuxt devProxy 不經 nginx，所以本機看起來一切正常。

30 秒 heartbeat（`system.ts:105-107`）能撐住 `proxy_read_timeout 120s` 不斷線，這部分沒問題。

**建議**：對 `/api/scan-events`（或整個 `/api/`）加上：

```nginx
location /api/scan-events {
    proxy_pass http://localhost:3000;
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 1h;
}
```

或在後端 SSE handler 補 `c.header('X-Accel-Buffering', 'no')`（同時處理未來換代理的情況）。部署後實際驗證一次進度事件是否即時。

### 2.5 掃描沒有併發防護；SSE snapshot 是全域單槽（中）— ✅ 已於 v0.4 處理

- **同一使用者可同時跑兩個掃描**：`POST /email/scan`（`system.ts:30`）沒有 in-flight 鎖，連點兩下、或手動掃描撞上整點 cron，就會兩條掃描同時處理同一批信。dedup 是 check-then-create（`email-parser.ts:136,261-277`），併發下兩邊都通過檢查；最後靠 `@@unique([bankId, billingPeriod])` 擋住其中一邊，但那會以 `unexpected` 錯誤浮到掃描結果，使用者看到莫名的失敗。順帶一提，PDF 檔在 create 之前就已寫入（`email-parser.ts:279-287`），失敗的那一邊會留下孤兒 PDF。
- **snapshot 單槽**：`scan-events.ts:41` 的 `snapshot` 只有一份。A 的掃描進行中、B 開始掃描 → snapshot 被 B 覆蓋 → A 這時重新整理頁面，`eventVisibleTo` 過濾掉 B 的 snapshot，A 拿不到自己還在跑的進度（`system.ts:96-102` 的 catch-up 失效）。cron 逐一掃全部使用者時（`scheduler.ts:51`），任何人刷新頁面都可能踩到。

**建議**：(1) 加一個 per-user 的 in-flight Set，掃描中回 409「掃描進行中」；(2) `snapshot` 改成 `Map<userId, ScanSnapshot>`，complete 時刪 key。兩者都是小改動。

### 2.6 刪除仍有帳單的銀行會回裸 500（中）— ✅ 已於 v0.4 處理

Schema 中 `Bill.bank` 是必要關聯且未指定 `onDelete`（`schema.prisma:50`），Prisma 預設為 `Restrict`。`DELETE /api/banks/:id`（`banks.ts:102-108`）對「有帳單的自訂銀行」直接 `bank.delete()` → 外鍵約束丟例外 → 專案**沒有全域 `app.onError`**，Hono 回預設 500，前端只看到「刪除失敗」。對照 `bank-accounts.ts:41-44` 有先檢查 `usedBy` 並回友善 400，銀行這條路漏了。

**建議**：短期在 delete 前檢查 `bill.count` 回 400；根本解是在 schema 明定 cascade 行為（見 4.2）並補全域 `app.onError`（統一 log + JSON 錯誤格式，也順便接住其他路由的漏網例外）。

### 2.7 sanity check 失敗的帳單照建、通知照發、內容不帶警告（中）— ✅ 已於 v0.4 處理

`email-parser.ts:252-259`：sanity 檢查失敗只記錯誤、標 `progressStatus = 'error'`，**沒有 `continue`**，程式繼續建立帳單。這看起來是刻意設計（錯誤訊息寫「請手動確認」），但接著 `processNewBill` 會發出**與正常帳單完全相同的 Telegram 通知**——只有 `parseSource === 'llm'` 才附「核對數值」提示（`telegram.ts:136-146`）。也就是說：template/hardcoded 解析出「金額 45 萬、90 天後到期」這種被 sanity 攔下的結果，使用者收到的通知看不出任何異常。

**建議**：把 sanity 失敗的事實傳遞下去——最簡單是在 `Bill` 上有記號（可重用 `parseSource` 之外加一欄，或 ScanError 對應到通知文案），通知加上「⚠ 解析結果異常，請核對」。或改為 sanity 失敗就不建帳單、只留 ScanLog 錯誤，二擇一，但目前「建了又不說」是最差的組合。

### 2.8 其他小項（低）— 🟡 部分已處理（enable-with-password、paidAt 狀態機、`useScanEvents.ts` stale comment 已修；`DELETE /api/bills/:id` 的手動級聯已隨 4.2 cascade FK 化為多餘；`banks.find()` 主旨大小寫、`shutdown()` graceful exit 仍未處理）

- **`POST /api/banks/enable/:code` 重新啟用時忽略 `pdfPassword`**（`banks.ts:32-39`）：已存在的 bank 只更新 `isActive`，body 帶的新密碼被丟棄。
- **`PATCH /api/bills/:id` 把 status 改成 `paid` 不會設定 `paidAt`**（`bills.ts:131-143`）：前端編輯模式的狀態下拉允許選「已繳」（`bills/[id].vue:434-439`），走這條路的帳單 `paidAt` 為 null，詳情頁的繳費時間區塊不會顯示。狀態機轉移（pay/unpay 對 `paidAt` 的成對維護）散落在三個 endpoint，建議收斂成一個 service 函式。
- **`DELETE /api/bills/:id` 兩步刪除沒包 transaction**（`bills.ts:254-255`）：先刪 notificationLog 再刪 bill，中間失敗會留下「通知紀錄消失但帳單還在」。對照 `users.ts:82-90` permanent delete 有用 `$transaction`，做法不一致。
- **`banks.find()` 比對大小寫不一致**（`email-parser.ts:146-149`）：寄件者用 `toLowerCase().includes`，主旨卻是區分大小寫的 `includes`。中文主旨通常無感，但英文主旨（如 HSBC）可能因大小寫 miss。
- **`shutdown()` 立即 `process.exit(0)`**（`serve.ts:17-20`）：`server.close()` 是非同步的，下一行就 exit 等於沒 graceful shutdown；另外 `uncaughtException` 選擇「記 log 繼續活」是有風險的取捨——狀態可能已損壞，配合 Docker `restart: unless-stopped`，crash-and-restart 通常更安全。
- **`useScanEvents.ts:39` 註解寫 `/api/system/scan-events`**，實際路徑是 `/api/scan-events`（stale comment）。
- **`system.ts:165` 的 email 搜尋 debug 路由**：預設 query 是 `newer_than:7d` 但 `sinceDays: 30`，兩個參數語意重疊且互相矛盾（gmail-imap 實作根本不讀 `sinceDays`，見 3.2）。

---

## 3. 架構與抽象設計

### 3.1 解析鏈有兩套實作，行為已經分歧（高）— ✅ 已於 v0.4 處理

目前存在兩條「把 PDF 文字變成帳單」的鏈：

| 使用場景 | 實作 | 順序 |
|----------|------|------|
| 正式掃描 | `email-parser.ts:196-250`（內聯） | template → hardcoded → **LLM** |
| debug/測試路由 | `registry.parseText()` + `bill-extractor.ts` | template → hardcoded → **generic** |

後果：

1. **generic parser（`parsers/generic.ts`）在正式掃描中永遠不會執行**。`Bill.parseSource` 的 `'generic'` 值（schema 註解、shared type、前端的「通用規則 ⚠」badge）在真實資料中不可能出現——除非這是刻意淘汰 generic 的決策，否則是行為漏洞；如果是刻意的，那 generic parser 與相關 UI 就是死碼。
2. **Parser Lab 測出來的結果與正式掃描不一致**：使用者在 `/parser/test-pdf` 看到「generic 解析成功」，實際掃描時同一份 PDF 卻走 LLM（或因 LLM 未設定而失敗）。測試工具失去意義。
3. 2.2 的 bug 分歧正是這種雙軌的直接產物。

**建議**：收斂成單一 `parseBill(text, bank, { allowLlm }): Promise<{ bill, source, errors }>` service，掃描與 debug 路由都走它；在該函式內明確決策 generic 的去留（建議：generic 排在 LLM 前面作為零成本嘗試，或徹底移除並清掉 `'generic'` 相關碼）。

### 3.2 `EmailProvider` 抽象洩漏 Gmail 專屬語法（高）— ✅ 已於 v0.4 處理

抽象的意圖很好（`services/email/types.ts` 定義了乾淨的 provider 介面），但實際上：

- 查詢字串由呼叫端以 **Gmail 搜尋語法**拼出（`email-parser.ts:101-105` 的 `from:(...) OR ... newer_than:60d has:attachment`），直接塞進 `SearchOptions.query`。
- 唯一的 provider 實作用 `client.search({ gmailraw: opts.query })`（`gmail-imap.ts:54`）——這是 **Gmail 才支援的 IMAP 擴充**。
- 但 UI 與 API 允許使用者填**任意 IMAP host**（`email.ts:11-16`、設定頁的 host/port 欄位），設定 Outlook/Fastmail/自架 mail server 的使用者會在掃描時直接失敗，而且 `POST /api/email/test` 只驗證登入、不驗證 `gmailraw` 能力，「測試成功、掃描必掛」。
- `SearchOptions.sinceDays` 被 gmail-imap 完全忽略（query 裡已內嵌 `newer_than:`），是半死參數；設定鍵名 `SCAN_GMAIL_QUERY_EXTRA` 也把 Gmail 假設寫進了全域設定。

**建議**（依投入程度擇一）：
1. **誠實化**：UI 鎖定 host 為 `imap.gmail.com`、文案明講只支援 Gmail，`EmailProviderName` 目前也只有 `'gmail-imap'`，先讓抽象與現實一致。
2. **修正抽象**：`SearchOptions` 改為結構化條件（senders[], sinceDays, hasAttachment），由各 provider 自行翻譯成 Gmail raw query 或標準 IMAP `SEARCH`（`OR FROM x FROM y SINCE date`）。這才是能長出第二個 provider 的介面。

另外 `fetch` 以 **IMAP UID 當 `sourceEmailId`**（`gmail-imap.ts:56`）：UID 在 UIDVALIDITY 變動時會整批失效/重排，屆時 dedup 判斷會失準（`duplicateBillExists` 是第二道防線，能擋掉大部分）。若要更穩，改用 `Message-ID` header 作為穩定識別。

### 3.3 `routes/system.ts` 是 434 行的大雜燴；`routes/settings.ts` 名實不符（中）— ✅ 已於 v0.4 處理

`system.ts` 混了六種職責：掃描觸發、SSE、掃描紀錄、Telegram 測試、整合狀態、Parser Lab（5 條 debug 路由）、LLM（3 條路由），全部掛在 `/api` 根層級。而 `routes/settings.ts` 實際處理的是 notification rules（掛載於 `/api/notification-rules`），真正的「設定」在 `routes/config.ts`——找程式碼時要靠記憶而不是命名。

**建議**：拆成 `scan.ts`（scan + SSE + logs）、`parser-lab.ts`、`llm.ts`、`integrations.ts`，`settings.ts` 改名 `notification-rules.ts`。純機械性搬移，配合現有測試低風險。

### 3.4 `ADMIN_ONLY` 集中式 regex 清單是易漏的守門模式（中）— ✅ 已於 v0.4 處理

`auth.ts:83-88` 用路徑 regex 清單決定哪些路由 admin-only。這個模式的問題是**預設 fail-open**：未來新增管理面路由（例如新的 `/api/config/xxx` 或把 LLM 路由搬家）時，必須記得回來改 `auth.ts`，忘了就是 member 可存取。規則和路由定義相距甚遠，regex 也容易與實際路徑脫節（目前 `POST /api/llm/test` 有守、同屬 LLM 開銷的 `POST /api/llm/suggest-rule` 沒守——後者看起來是刻意允許 member 用，但這種「例外」在集中清單裡讀不出意圖）。

**建議**：改為在路由定義處掛 `adminOnly` middleware（`app.use(adminOnly)` 或 per-route），守門邏輯與路由同檔同行，新路由天然帶上正確權限；`role-guard.test.ts` 保留作為回歸驗證。

### 3.5 shared package 沒有發揮應有作用（中）— ✅ 已於 v0.4 處理

`packages/shared` 已存在且設計了不錯的 DTO（`BillDTO`、`BillDetailDTO`…），但：

- **前端 composables 幾乎全用 `any`**：`useBillApi.ts` 的 `get<any>`、`useSettingsApi.ts` 的 `get<any[]>` 等，web 專案共 27 處 `any`。shared DTO 在 server 端也沒真正用來 shape 回應（路由多半直接 `c.json(prismaRow)`，欄位是否符合 DTO 全靠巧合）。
- **同構型別重複三處**：`ScanEvent` 在 `services/scan-events.ts` 與 `composables/useScanEvents.ts` 各一份；`ScanError`/`ScanErrorStage`/`ScanLogDTO` 在 `email-parser.ts` 與 `useSettingsApi.ts` 各一份；`NotificationRule`、`EnabledBank`、`BankAccount`（→ shared 已有 `BankAccountDTO`）、`BankPreset`（→ shared 已有）在 `web/types/settings.ts` 與頁面內重複宣告。任何一端改欄位，另一端不會有編譯錯誤，只會在 runtime 壞。
- **顯示層工具函式五份拷貝**：`formatAmount` ×5（`pages/index.vue`、`bills/index.vue`、`bills/[id].vue`、`telegram.ts`、`calendar-feed.ts`）、`formatDate` ×5、`daysUntil` ×4，且「剩 N 天」的顏色/文案邏輯在 `index.vue` 的 `DaysRemainingBadge` 與 `[id].vue` 的 `daysRemainingInfo` 又是兩份。

**建議**：(1) 把 `ScanEvent`/`ScanError`/`ScanLogDTO` 移進 shared（server 端的 `userId` 欄位可用 `Omit` 處理）；(2) shared 加 `format.ts`（`formatAmount`/`formatDate`/`daysUntil`/`daysRemainingBadge`），web 加一個 `<DaysRemaining>` 元件；(3) composables 逐步以 shared DTO 取代 `any`——這三步都不需要動行為。

### 3.6 前端頁面過大、關注點混雜（低-中）— ✅ 已於 v0.4 處理

`pages/banks/index.vue` 635 行：內建銀行、 自訂銀行、銀行帳戶三個領域 + 6 個 dialog 全在一檔，state 有 15+ 個 ref。`bills/[id].vue` 594 行同樣混了檢視/編輯/付款/刪除/重解析。功能上沒問題，但每次改動的 diff 面積和心智負擔偏大。

**建議**：至少把 dialog 抽成子元件（`BankEditDialog`、`BankAccountSection`…），banks 頁可拆三個 section 元件。另外 `banks/index.vue:381` 的 Switch handler `bankApi.update(...).then(fetchData)` 沒有 catch，失敗時 UI 無回饋且 promise unhandled。

### 3.7 通知管道的抽象不完整（低）— ✅ 已於 v0.4 處理

`processReminderRules` 內 `if (channel === 'telegram')` 是唯一分支（`notification.ts:88-97`），`'calendar'` channel 被靜默跳過（歷史資料裡可能還有含 calendar 的規則，zod 也仍接受它，見 4.1）。若未來要加 channel（email、webhook、LINE），建議先立一個 `NotificationChannel` interface（`send(user, bill, context)`）＋ registry，跟 bank parser 的 plugin 模式對齊；若不打算加，就把 `'calendar'` 從 zod enum 和常數中移除，語意收斂為「telegram only + ICS feed 是拉式訂閱、與規則無關」。

---

## 4. 資料結構設計

### 4.1 死欄位與殭屍值（中）— ✅ 已於 v0.4 處理

| 欄位/值 | 位置 | 狀態 |
|---------|------|------|
| `Bill.calendarEventId` | `schema.prisma:58` | **全 codebase 零引用**（Google Calendar API 整合移除後的遺留） |
| `NotificationRule.timeOfDay` | `schema.prisma:74` | 存了但邏輯未實作（見 2.1） |
| `channels` 的 `'calendar'` 值 | `routes/settings.ts:13` zod 仍接受 | 處理器忽略、UI 已不提供（`web/types/settings.ts:44-46` 只剩 telegram） |
| `parseSource` 的 `'generic'` 值 | `schema.prisma:56` 註解、shared types、前端 badge | 正式掃描永遠不會寫入（見 3.1） |
| `User.imapHost/Port/User/Password` | `schema.prisma:133-136` | 活著，但 `email.ts:27-29` 收了 `provider: 'gmail-imap'` 卻**沒有欄位可存**——未來若真支援多 provider，DB 缺一欄 |

**建議**：做一次 schema 大掃除 migration：刪 `calendarEventId`；`timeOfDay` 依 2.1 的決策處理；zod enum 收斂；若保留 provider 概念就補 `emailProvider` 欄位，否則把 API 的 `provider` 參數拿掉。

### 4.2 外鍵行為未明定，依賴 Prisma 隱含預設（中）— ✅ 已於 v0.4 處理

`User` 的關聯都明確標了 `onDelete: Cascade`，但 `Bill.bank`、`NotificationLog.bill` 沒標（隱含 `Restrict`）、`NotificationLog.rule` 隱含 `SetNull`。這造成：

- 2.6 的 500 錯誤。
- `bills.ts:254-255` 與 `users.ts:82-90` 需要手動層層刪除（且一處有 transaction、一處沒有）。

**建議**：明確宣告——`Bill.bank` 與 `NotificationLog.bill` 加 `onDelete: Cascade`（帳單/通知紀錄沒有脫離母體存在的意義），`NotificationLog.rule` 明寫 `onDelete: SetNull`。之後 `bills.ts` 的手動刪 log、`users.ts` transaction 裡的前兩行都可以刪掉，行為交給 DB 保證。

### 4.3 JSON 欄位寫入端不驗證（低-中）— ✅ 已於 v0.4 處理

專案慣例是「SQLite JSON 欄位存 stringified JSON，應用層 parse」，但寫入端品質不一：

- `Bank.parserConfig`：`PATCH /api/banks/:id` 接受任意字串（`banks.ts:72`），壞 JSON 要等到掃描時才被 `try/catch` 吞掉、悄悄 fallback 到下一層 parser（`email-parser.ts:199-210`）——使用者不會知道自己的模板規則從未生效。
- `NotificationRule.channels` 有 zod array 驗證後才 stringify，是好的對照組。

**建議**：`parserConfig` 在寫入時用 zod（`TemplateParserConfig` 的 schema 已經在 `system.ts:314-326` 定義過，搬到 shared 重用）驗證再存；掃描時 parse 失敗應記進 ScanError 而非只留 server log。

### 4.4 索引與查詢（低）— 🟡 部分已處理（`@@index([status, dueDate])`、`@@index([bankId])`、`@@index([expiresAt])` 已隨 4.2 的 migration 補上；`ownBill()` 雙查詢與 `/summary` 記憶體加總兩個查詢模式未變更）

家庭規模下 SQLite 全表掃描無感，這節是 nice-to-have：

- `bills` 常用查詢條件 `status`、`dueDate`（提醒/逾期掃描）、`bank.userId`（每條 API）都沒有索引；`sessions.expiresAt`（每次登入的 cleanup `deleteMany`）同樣。若未來資料量成長（多年帳單 × 多使用者），`@@index([status, dueDate])` 與 `@@index([bankId])` 是第一批候選。
- `GET /api/bills/:id` 模式是 `ownBill()` findFirst + 再 findUnique with include（`bills.ts:117-128`），一次 findFirst 帶 include 即可，少一輪 DB。
- `/summary` 把全部 pending rows 拉進記憶體算總和（`bills.ts:35-44`），可用 `prisma.bill.aggregate({ _sum, _count })`。

### 4.5 Settings 表的 env 優先序是好設計，但有一個小陷阱（低）— ➡️ 追蹤中

`getSetting` 的「env 蓋 DB」（`settings.ts:41-50`）合理，但 UI 的 config 頁不知道某鍵已被 env 鎖定——admin 在 UI 改了 `LLM_PROVIDER`，若 env 有值，改動寫進 DB 卻永遠不生效，UI 也顯示不出「目前由環境變數控制」。建議 `GET /api/config/status` 回傳每鍵的 `source: 'env' | 'db' | 'default'`，UI 對 env 鎖定的欄位顯示唯讀提示。

---

## 5. 安全性

前置條件先講清楚：這是家庭自架、前有 Cloudflare Access 的服務，以下項目多數是「深度防禦」而非迫切漏洞，依你的威脅模型取捨。

### 5.1 機敏資料明碼存放與回傳（中）— ✅ 已於 v0.4 處理

- **DB 明碼**：`User.imapPassword`（Gmail App Password）、`Bank.pdfPassword`（多數是身分證字號！）、Settings 表的 `telegram_bot_token`/`gemini_api_key`/`openai_api_key` 全部明碼存在 SQLite 檔案裡，而 `./data` 目錄就是 host 上的一個 bind mount。
- **API 回傳**：`GET /api/banks` 未做欄位篩選（`banks.ts:16-21`），每次列表都把 `pdfPassword` 送到前端（編輯 dialog 也確實回顯它——這是刻意的 UX，但代價是身分證字號常駐於瀏覽器記憶體與任何 API log/監控中）。
- 對照組做得好：`users.ts` 的 `toDTO` 只回傳 `emailConfigured` 布林、`config.ts` 只回 `isConfigured`。

**建議**：(1) banks 列表對 `pdfPassword` 遮罩（回 `hasPdfPassword: true`），編輯時走單獨端點或「留空=不變更」語意；(2) 若要進一步，用 `ENCRYPTION_KEY` env 對三類 secret 做 at-rest 加密（AES-GCM 一個 helper 就夠），DB 檔案外洩時不至於直接暴露身分證字號與信箱密碼。

### 5.2 `POST /api/email/test` 可當內網探測器（低）— ➡️ 追蹤中

任何登入者（含 member）可指定任意 host:port 讓伺服器發起 IMAP 連線（`email.ts:19-24`），錯誤訊息回傳 connect refused/timeout 等差異，等於一個內網 port scanner。家庭環境成員可信任，風險低；若要收斂，限制 host allowlist（`imap.gmail.com` 起步）與 2.5 的 rate limit 即可，與 3.2 的「誠實化」方向一致。

### 5.3 未設上限的檔案上傳（低-中）— ✅ 已於 v0.4 處理

`bodyLimit` 只掛在 auth 子路由（`auth.ts:94-97`）。`POST /api/parser/test-pdf` 用 `c.req.formData()` 把整個上傳 buffer 進記憶體（`system.ts:238-247`），沒有大小限制；`/parser/test-text` 的 JSON 同樣未限制。登入使用者一個 500MB 的「PDF」就能讓 Node OOM。**建議**：全域掛一個寬鬆的 bodyLimit（如 25MB），auth 子路由維持 16KB。

### 5.4 其他（低）— ✅ 已於 v0.4 處理

- `app.use('/api/*', cors())`（`index.ts:47`）：預設允許任意 origin。同源部署 + cookie auth 下它幾乎沒有作用，反而放寬了無憑證的跨源讀取。建議直接移除（同源不需要 CORS），或鎖 `APP_BASE_URL`。
- `scryptSync`（`auth service`）在請求路徑上同步阻塞 event loop（每次登入 ~50-100ms）。有 lockout 限流，風險可控；換成 `node:crypto` 的 async `scrypt` 是十行內的改動。
- 登入限流只 per-username，沒有 per-IP；lockout 狀態在記憶體，重啟即清空。CF Access 前置下可接受，列出供知悉。
- `setup` 端點理論上有 race（兩個併發請求都看到 `count()===0` → 建出兩個 admin）。首次啟動的幾秒鐘內才存在，風險趨近於零，但一行 `role: 'admin'` 前置 unique 檢查或 catch P2002 可根除。

---

## 6. 效能

規模是「一家人、每月幾十封信」，以下按實際體感排序：

1. **儀表板每次載入都做一次真實 IMAP 連線**（中）— ✅ 已於 v0.4 處理：`pages/index.vue:358-365` mount 時呼叫 `GET /api/email/status`，該端點對已設定信箱的使用者執行 `verifyConnectionFor` → 完整 IMAP connect/logout（`email.ts:43-45`）。首頁只需要 `hasCredentials` 布林。**建議**：`/email/status` 拆成輕量版（只讀 DB 欄位）與 `?verify=true` 版，或前端改呼叫不驗證連線的端點。這是使用者每天都會感受到的延遲。
2. **LLM 呼叫沒有 timeout**（中）— ✅ 已於 v0.4 處理：`invokeOllama`/`invokeOpenAI` 的 `fetch` 沒帶 `AbortSignal`（`llm-parser.ts:175,199`），Gemini SDK 也未設 timeout。本地 Ollama 卡住時，整個掃描（和 SSE 進度）會無限期停在該封信。對照 `pdf-parser.ts:20-28` 有寫 30s timeout，標準不一致。**建議**：統一用 `AbortSignal.timeout(60_000)`。
3. `processReminderRules` 是 rules × bills × per-bill `findFirst` 的 N+1（`notification.ts:53-98`）；`getMultiple` 逐鍵序列查詢（目前無人使用）。家庭規模無感，重構時順手改即可，不值得專程動。
4. 掃描逐封序列處理是**正確的選擇**（IMAP session 單連線、LLM 供應商限流），不建議平行化。

---

## 7. 測試與 CI

### 7.1 CI 沒有跑任何測試或 lint（中）— ✅ 已於 v0.4 處理

`.github/workflows/build.yml` 只做 Docker build/push（tag 觸發）。專案有 14 個測試檔與 eslint 設定，但**沒有任何 CI job 執行它們**——tenant isolation 這種安全護欄測試，只有在開發者記得本機跑時才有效。

**建議**：加一個 `test.yml`：PR 與 push to main 時 `pnpm install → pnpm -r test → pnpm lint`。這是本報告所有建議中 CP 值最高的一項。

### 7.2 測試覆蓋的空白區（低-中）— ✅ 已於 v0.4 處理

- **Bank parsers 幾乎零測試**：`parsers/__tests__/` 只有 `registry.test.ts`。八個 hardcoded parser 的 regex（如 esun 的三段式表格 pattern）是最容易被銀行改版悄悄弄壞的部分，也是最適合用「去識別化 fixture 文字」做快照測試的部分——`deriveBillingPeriod` 的月底 bug（2.2）若有 fixture 測試早就浮出來。
- **`template.ts`/`generic.ts`/`utils.ts` 的日期與金額邊界**（ROC 年、29-31 號、負數金額）無測試。
- **排程邏輯**（`shouldScan`、`processReminderRules` 的日界窗）無測試——正是 2.1/2.3 藏身處。
- Web 端零測試：可接受（UI 為主），但 `useScanEvents` 的事件 reducer 是純函式，值得測。

### 7.3 Lint 只覆蓋 web（低）— ✅ 已於 v0.4 處理

`turbo lint` 只會執行 web 的 eslint；server 與 shared 沒有 lint script。`telegram.ts` 用 `console.error/warn` 而其餘用 pino（`telegram.ts:20,26,34`）這類不一致，就是沒 linter 盯的結果。建議 server 上 eslint（可共用 root flat config）並在 CI 跑。

---

## 8. 文件與死程式碼

### 8.1 README 與現實嚴重脫節（中）— ✅ 已於 v0.4 處理

`README.md` 仍是 Gmail API 時代的敘述：

- 「Periodically fetches ... via **Gmail API**」「configure **Gmail OAuth**」——實際是 per-user IMAP。
- 「sends reminders via Telegram and **Google Calendar**」「Google Calendar events」——實際是 ICS feed 訂閱。
- Docker Compose 範例把 port 對映到 `:3000`，**照抄會直接部署失敗**——現行 image 是 nginx 聽 `:80`（repo 內的 `docker-compose.yml` 是對的，README 是舊的）。
- 支援銀行表列 7 家，缺 `hsbc_tw`、`chb`、`fubon`。
- 「LLM fallback - Uses Gemini」——現已支援 Gemini/OpenAI/Ollama。

### 8.2 CLAUDE.md 漂移（低）— ✅ 已於 v0.4 處理

- 「`apps/server/src/db/` — Prisma schema and client」：該目錄不存在（schema 在 `apps/server/prisma/`，client 是 `src/prisma.ts`）。
- 「Notifications: Telegram Bot API + **Google Calendar API**」「Email: **Gmail API (OAuth 2.0)**」：同 README 的漂移。
- 對 AI 輔助開發的專案來說，CLAUDE.md 錯誤會被每一次 session 繼承，優先級比 README 高。

### 8.3 死程式碼清單（逐項驗證過）— 🟡 部分已處理（`radix-vue`、`TEMPLATE_PRESETS`、`Bill.calendarEventId`、`getPdfBuffers` 的 `zipPassword` 參數、`email-pdf-extract.ts` 已清除或修好；`db:seed` 腳本、`DEFAULT_NOTIFICATION_RULES`、`NOTIFICATION_CHANNEL_LABELS`、`getMultiple()` 仍是零引用死碼）

| 項目 | 位置 | 說明 |
|------|------|------|
| `scripts/email-pdf-extract.ts` | import `../src/services/gmail.js` | **該模組已刪除，腳本必定跑不起來**；改用 `getEmailProviderFor` 或刪除 |
| `db:seed` script | `apps/server/package.json` | 指向不存在的 `src/db/seed.ts` |
| `radix-vue` 依賴 | `apps/web/package.json` | 全 codebase 零 import（已被 reka-ui 取代），可移除 |
| `DEFAULT_NOTIFICATION_RULES` | `shared/constants.ts:6` | 零引用（且內容還含已淘汰的 calendar channel） |
| `NOTIFICATION_CHANNEL_LABELS` | `shared/constants.ts:1` | 零引用 |
| `TEMPLATE_PRESETS` | `shared/template-parser.ts:34` | 零引用——五家銀行調校好的模板規則沒有任何程式使用（若原意是啟用銀行時 seed `parserConfig`，這是個沒接上的 feature） |
| `getMultiple()` | `services/settings.ts:64` | 零引用 |
| `getPdfBuffers` 的 `zipPassword` 參數 | `pdf-parser.ts:92` | 宣告未使用（adm-zip 也不支援加密 zip，註解還聲稱用的是「Node.js built-in ZIP」） |
| `Bill.calendarEventId` | schema | 見 4.1 |

---

## 9. 建議路線圖

### 第一批：快贏（每項 ≤ 半天，先做）

1. **CI 加 test + lint job**（7.1）——之後所有修改都有護欄。
2. **修 `deriveBillingPeriod` 溢位**：抽 shared helper、兩處共用、補月底測試（2.2）。
3. **Dockerfile 加 `ENV TZ=Asia/Taipei`** 並在兩個 `cron.schedule` 傳 `timezone`（2.3 的止血版）。
4. **nginx SSE 加 `proxy_buffering off`**（或後端補 `X-Accel-Buffering: no`），部署後驗證（2.4）。
5. **per-user 掃描鎖 + snapshot 改 Map**（2.5）。
6. **`timeOfDay` 二選一**：實作或移除（2.1）。
7. **死碼清理**：8.3 整表 + README 的 compose 範例 port + CLAUDE.md 的 `src/db`（8.x）。
8. **全域 `app.onError` + banks delete 前置檢查**（2.6）。

### 第二批：結構收斂（1-2 天級）

9. **解析鏈統一成單一 service**，決策 generic 的去留（3.1）。
10. **schema 大掃除 migration**：cascade 明確化、刪 `calendarEventId`、channels enum 收斂（4.1、4.2）。
11. **shared 型別/格式化工具收斂**：ScanEvent/ScanError/DTO 單一來源、format helpers、composables 去 `any`（3.5）。
12. **`GET /api/banks` 遮罩 `pdfPassword`** + 全域 bodyLimit（5.1、5.3）。
13. **dashboard 的 email status 拆輕量端點**、LLM fetch 加 timeout（6.1、6.2）。
14. **sanity check 失敗的通知帶警告**（2.7）。
15. **dueDate 寫入路徑統一**（2.3 的根治版——若做了 date-only 重構，第 3 項的 TZ 依賴會大幅下降）。

### 第三批：值得但不急

16. Email 抽象修正或誠實化為 Gmail-only（3.2）。
17. `system.ts` 拆檔、`settings.ts` 改名、ADMIN_ONLY 改 route middleware（3.3、3.4）。
18. Secrets at-rest 加密（5.1 進階）。
19. Bank parser fixture 測試（7.2）。
20. 大型頁面元件化（3.6）。

---

*本報告所有「零引用」「未使用」結論均以 grep 全 codebase 驗證；所有行為推論均附程式碼位置。時區相關項目（2.3）的實際影響取決於部署環境的 `TZ` 設定，建議修復前先在正式環境確認 `date` 輸出。*
