# Bill Alarm — 重複帳單修復 + 帳密認證 + PWA 設計

日期：2026-07-04
狀態：待使用者核准

## 背景與目標

1. **重複帳單**：線上環境（bill.ysya.me）實際存在 2 組重複紀錄，根因是去重鍵依賴 LLM 產出的 `billingPeriod`（詳見下方證據）。
2. **手機體驗**：目前經 Cloudflare Access 登入牆存取，手機上開啟阻力大。目標：Nuxt 加上 PWA + 應用自身帳密認證，之後由使用者自行移除 CF Access（保留 CF Tunnel 作為入口）。

**非目標**：Expo/原生 app、多使用者、2FA、離線操作、資料同步。

## 線上環境證據（2026-07-04 撈取，共 33 筆帳單）

兩組重複，對應兩種成因：

| 銀行 | 保留 | 刪除 | 成因 |
|------|------|------|------|
| 中國信託 | `019e4be9-d9a1…`（2026-05） | `019e5146-f94a…`（2026-06） | 同一封信（IMAP UID 46567）在 5/21、5/22 兩次掃描中，LLM 對同一份 PDF 回了不同 billingPeriod（PDF 帳單年月為 115/05，2026-06 是錯的） |
| 滙豐 | `019e5146-6075…`（2026-05，已繳） | `019df614-4afd…`（2026-04，顯示逾期） | 同一份帳單在 Gmail API → IMAP 遷移前後被視為兩封信（sourceEmailId：hex `19df478…` vs UID `46053`），LLM 又回了不同期別。**此筆假逾期須刪除** |

另發現副作用：玉山 2026-02 與 2026-03 兩筆帳單共用 `pdfs/esun_2026-03.pdf`（檔名以 billingPeriod 命名，衝突時後者覆寫前者的 PDF）。

## 設計一：重複帳單防治（apps/server）

修改 `services/email-parser.ts` 與 `services/llm-parser.ts`：

1. **sourceEmailId 短路**：掃描迴圈取得 `msgId` 後（比對銀行前），先查 `prisma.bill.findFirst({ where: { sourceEmailId: msgId } })`，命中即跳過（progressReason「此信件已建立過帳單」）。防止同信重複解析，同時省下對近 60 天舊信的重複 LLM 呼叫。
2. **近似重複防護**：建檔前查同 `bankId` + `amount` + `dueDate` 是否已存在，存在即跳過（progressReason「已存在同金額同到期日帳單」）。這是唯一能擋住「換信箱 provider 後同帳單換 ID」情境的防線（滙豐案例）。
3. **LLM 輸出穩定化**：Gemini、OpenAI、Ollama 三個 provider 統一設 `temperature: 0`。
4. **修 fallback 溢位**：`parseBillResponse` 的 `setMonth(getMonth() - 1)` 在月底日期（29–31 日）會溢位到下個月。改為以年月數值計算（`year/month` 直接運算，不經 Date 物件的日期借位）。
5. **PDF 檔名防覆寫**：`${bank.code}_${billingPeriod}.pdf` 改為 `${bank.code}_${msgId}.pdf`（msgId 存檔前已知，無需調整建檔順序）。

**既有資料清理**：使用者於 UI 手動刪除上表兩筆（或核准後由 API 刪除）。

**選配（待使用者決定）**：掃描路徑在 template 之後、LLM 之前接回 hardcoded parsers（`parsers/registry.ts`）。線上資料顯示 4 月曾有 `parseSource: "hardcoded"` 的紀錄，之後的掃描重構把這條路徑拿掉了，現在所有新帳單都走 LLM。接回可讓已支援的銀行改走確定性解析，從源頭消除 LLM 期別輪盤。注意：工作區有未提交的 `parsers/hsbc.ts` 修改，實作時避免衝突。

## 設計二：帳密認證（單一使用者）

### 資料

- `Setting` 新增鍵：`AUTH_USERNAME`（明文）、`AUTH_PASSWORD_HASH`（Node 內建 `crypto.scrypt`，N=2^14/r=8/p=1，格式 `salt:hash` hex，比對用 `timingSafeEqual`；不引入原生依賴）。
- 新增 Prisma model `Session`：`id`（uuid）、`tokenHash`（sha256(token) hex，unique）、`createdAt`、`expiresAt`、`lastExtendedAt`。

### API（`routes/auth.ts`）

- `POST /api/auth/setup`：僅當 `AUTH_PASSWORD_HASH` 未設定時可呼叫，設定帳密後自動登入。
- `POST /api/auth/login`：驗證帳密 → 建 Session、發 cookie。失敗限速：記憶體計數，連續 5 次失敗全域鎖 15 分鐘（單人系統不分 IP）。
- `POST /api/auth/logout`：刪除 Session、清 cookie。
- `GET /api/auth/me`：回傳 `{ username }`；未登入 401（前端以此判斷導向）。

### Cookie 與 Session

- Cookie：`ba_session`，httpOnly、secure、sameSite=Lax、path=/、maxAge 30 天。
- 滾動續期：驗證通過且距 `lastExtendedAt` 超過 24 小時 → 展延 `expiresAt` 至 30 天後並更新 cookie。
- 登入時順帶清除過期 Session 列。
- CSRF：sameSite=Lax + 純 JSON API（無 form post），足夠。

### Middleware（`index.ts`）

保護所有 `/api/*`，白名單：

- `POST /api/auth/login`、`POST /api/auth/setup`（僅未初始化時）
- `GET /api/health`（保持無認證，供監控）
- `GET /api/calendar/feed/:token.ics`（既有 token 機制，不變）

靜態頁面（Nuxt SPA 產物）不擋 — SPA 殼不含資料，資料一律走被保護的 API。

### 前端（apps/web）

- `/login` 頁：帳密表單；`/setup` 頁：首次設定（`/api/auth/setup` 可用時才進得去，否則導向 `/login`）。
- Nuxt route middleware：呼叫 `/api/auth/me`，401 → 導向 `/login`（`/login`、`/setup` 除外）。
- API composable 統一攔截 401 → 導向 `/login`。
- 登出按鈕放設定頁。

## 設計三：PWA（apps/web）

- 套件：`@vite-pwa/nuxt`（Nuxt 已是 `ssr: false` SPA，產物為靜態檔，相容）。
- Manifest：`name: Bill Alarm`、`display: standalone`、`theme_color`/`background_color` 依現有 UI 主色、icons 192/512 + maskable + apple-touch-icon（新產生簡潔的卡片圖樣）。
- Service Worker：precache app shell（`registerType: autoUpdate`）；**API 一律 NetworkOnly 不快取**（帳務資料不可呈現舊快取）。
- iOS：加入主畫面後 standalone 執行；cookie 在 standalone WebView 持久化正常，配合 30 天滾動 session，日常開啟即用免登入。

## 部署與切換順序

1. 上線後首次造訪 → `/setup` 設定帳密（此時 CF Access 仍在，雙層保護下完成初始化）。
2. 手機安裝 PWA、確認登入與 30 天 session 正常。
3. 使用者自行於 Cloudflare 移除 bill.ysya.me 的 Access 政策（保留 Tunnel），建議同時在 CF 加 `/api/auth/login` 的 rate-limit 規則。（此步驟由使用者操作，不在程式範圍內）

## 測試

- 單元：`parseBillResponse` fallback 月底溢位案例（due 2026-03-31 → billingPeriod 應為 2026-02）；sourceEmailId 短路；近似重複防護；scrypt hash/verify；session 過期與續期；login 失敗鎖定。
- 整合：middleware 對白名單/非白名單路徑的 401/200。
- 手動驗收：手機安裝 PWA → 登入 → 關閉重開免登入；掃描一次確認不產生重複帳單。

## 風險

- **曝露面擴大**：移除 CF Access 後，應用直面網際網路，資料含銀行帳單、IMAP 密碼、LLM API key。緩解：上述硬化 + CF Tunnel（origin 不直曝）+ CF rate limit。
- **忘記密碼**：無重設流程（單人系統）。補救：進 container 刪 `AUTH_PASSWORD_HASH` setting 後重新 setup，README 記載此程序。
- **iOS PWA cookie 清除**（使用者手動清除 Safari 資料時連動）：重新登入即可，屬可接受。
