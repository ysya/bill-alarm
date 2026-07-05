# Bill Alarm — 多使用者管理（家人共用）設計

日期：2026-07-05
狀態：已核准（使用者確認「可以」）

## 背景與目標

現況為單人系統：帳密存在 `settings` 表（`auth_username` / `auth_password_hash`）、`Session` 不綁使用者、Telegram 通知發到單一全域 chat id。目標：開放家人使用 — 全家共用同一份帳單資料，admin（現有帳號）／member（家人）兩種角色，admin 開帳號，每人各自綁定 Telegram 接收通知。

使用者已確認的四個決策：

1. **資料模式**：全家共用一份（不做 per-user 資料隔離）
2. **成員權限**：member 可日常操作（看帳單、標記已繳、觸發掃描），設定類僅 admin
3. **帳號開立**：admin 開帳號＋設初始密碼；member 可自行改密碼；忘記密碼由 admin 重設；無自助註冊
4. **通知**：每人綁自己的 Telegram（深度連結自動綁定），到期通知 fan-out 給所有已綁定者

**非目標**：per-user 資料隔離、per-user 通知規則、per-user 行事曆訂閱（ICS 連結維持全家共用一條）、多 admin、角色切換、邀請碼註冊、email 密碼重設、bot 常駐 long-polling、持卡人標記。

## 設計

### 1. 資料模型與遷移

```prisma
model User {
  id             String    @id @default(uuid(7))
  username       String    @unique
  passwordHash   String    // scrypt "saltHex:hashHex"（沿用 services/auth.ts）
  role           String    @default("member") // 'admin' | 'member'
  telegramChatId String?
  createdAt      DateTime  @default(now())
  updatedAt      DateTime  @updatedAt
  sessions       Session[]

  @@map("users")
}

model Session {
  // 既有欄位不變，新增：
  userId String
  user   User   @relation(fields: [userId], references: [id], onDelete: Cascade)
}
```

手寫 SQL migration（同 `add_sessions` 作法）：

1. 建 `users` 表
2. 資料搬移：若 `settings` 有 `auth_username` → 以該帳密建 admin 使用者（id 用 `lower(hex(randomblob(16)))`，SQL 內無 uuid7 不影響正確性）；`settings.telegram_chat_id`（若存在）搬到 admin 的 `telegramChatId`
3. 刪除 `settings` 中 `auth_username`、`auth_password_hash`、`telegram_chat_id` 三個 key
4. 清空 `sessions` 後重建表加入 `userId TEXT NOT NULL` + FK（升級後全員重新登入一次，帳密不變）

**Env 邊角**：`getSetting` 是 env 優先。若部署以 `TELEGRAM_CHAT_ID` env 設定 chat id，SQL 遷移看不到 → admin 呈未綁定，需在 UI 重新綁定一次（設定頁 Telegram 狀態卡會顯示綁定人數，未綁定即可見）。同步從 `ENV_MAP` 移除 `TELEGRAM_CHAT_ID`，避免殘留 env 復活舊行為。`TELEGRAM_BOT_TOKEN` 維持全域 setting（env 或 DB）。

角色規則：admin 唯一（遷移或 setup 產生的第一個帳號），之後開的帳號一律 `member`；admin 不可刪除；不做角色變更。

### 2. 認證與權限

- `authGuard` 驗 session 後把使用者（id、username、role）掛到 context；session 資料查詢 include user。
- **member 中央 allow-list（在 authGuard 內，deny by default）**，比對 method + path：
  - `GET /api/bills`、`GET /api/bills/summary`、`GET /api/bills/:id`、`GET /api/bills/:id/pdf`、`PATCH /api/bills/:id/pay`
  - `GET /api/banks`（帳單頁銀行名稱／篩選用）
  - `POST /api/email/scan`、`GET /api/scan-events`、`GET /api/scan-logs`（觸發掃描、進度、紀錄頁）
  - `GET /api/integrations/status`、`GET /api/email/status`（總覽／狀態顯示用，回傳僅設定與否的布林，無機密）
  - `GET /api/calendar/info`（行事曆訂閱連結）
  - 自身帳號：`GET /api/auth/me`、`POST /api/auth/logout`、`POST /api/auth/password`、`POST /api/auth/telegram/bind`、`POST /api/auth/telegram/confirm`、`DELETE /api/auth/telegram`
  - 其餘一律 403（銀行/帳戶寫入、帳單編輯/刪除/重解析、config/*、email test/save、通知規則、parser/LLM 工具、calendar rotate、使用者管理）
- 既有公開 whitelist 不變（health、auth login/setup/status、calendar feed ics）。
- **登入鎖定改按 username 計**：每個提交的 username 獨立計數（含不存在的 username，避免帳號枚舉），5 次失敗 → 鎖 15 分鐘；in-memory Map，保留 `_resetAuthRateLimit` 測試 helper。
- **改密碼**：`POST /api/auth/password` `{ currentPassword, newPassword }`，驗舊密碼；新密碼驗證規則與 setup 相同；成功後撤銷該使用者「其他」sessions（保留當前）。
- **admin 重設密碼**：撤銷該使用者全部 sessions。
- `/api/auth/setup`：改為建立 admin `User`；`initialized` 改看 `users` 有無資料。
- `/api/auth/me` 回 `{ username, role, telegramBound }`。

### 3. 使用者管理（admin 專屬）

API（新檔 `routes/users.ts`，掛在 `/api/users`）：

- `GET /api/users` → `[{ id, username, role, telegramBound, createdAt }]`
- `POST /api/users` `{ username, password }` → 建 member；username 重複回 409
- `POST /api/users/:id/reset-password` `{ password }` → 重設＋撤銷該人全部 sessions
- `DELETE /api/users/:id` → 刪除（FK cascade 清 sessions）；目標為 admin 時回 400

UI：設定頁「帳號」區新增「使用者管理」卡（僅 admin 渲染）— 成員列表（username、TG 綁定狀態、建立時間）、新增帳號、重設密碼、刪除（確認後執行）。

### 4. Telegram 每人綁定與通知 fan-out

**綁定流程**（深度連結）：

1. `POST /api/auth/telegram/bind` → 產生一次性驗證碼（16 hex chars，10 分鐘效期，in-memory Map `code → { userId, expiresAt }`）→ 回 `{ deepLink: "https://t.me/<botUsername>?start=<code>", expiresAt }`；bot username 以 `getMe` 取得並以 process 生命週期快取；bot token 未設定回 400
2. 使用者開連結、在 Telegram 按 Start（送出 `/start <code>`）
3. 回 app 按「完成綁定」→ `POST /api/auth/telegram/confirm` → 呼叫 `getUpdates` 掃描訊息文字 `/start <code>` → 命中則存 `String(message.chat.id)` 到該使用者、消耗驗證碼；未命中回 404（前端提示「還沒收到 Start，請先在 Telegram 按 Start 再試」）；過期回 410
4. `DELETE /api/auth/telegram` → 解綁（設 null）

前提註記：系統從未設定 webhook（現況 send-only），`getUpdates` 可直接使用；不 commit offset，靠 Telegram 24h 自動過期（家庭規模足夠）。

**telegram service 重構**：

- `sendMessage(chatId, text)` 收 chat id 參數
- `broadcast(text)`：收件人 = 所有 `telegramChatId != null` 的使用者，**chat id 去重**（兩人綁同一群組只送一次）；回傳各收件結果
- 三種通知（新帳單／到期提醒／逾期警告）內容不變，改走 broadcast；`NotificationLog` 結構不動：一則通知一列，至少一人成功即 `success=true`，失敗者彙整進 `errorMessage`
- 無人綁定時行為同現況未設定：跳過並 log warn
- `POST /api/telegram/test`（admin 測試鈕，system routes 掛於 `/api` 根下）：發給「當前使用者」自己的綁定；未綁定回 400 提示先綁定
- 整合設定 Telegram 卡：僅剩 bot token 欄位（chat id 欄位移除）；狀態顯示 token 是否設定＋已綁定人數

### 5. 前端

- `useAuth` 擴充 `role`、`telegramBound`；`useApi` 增加 403 處理 → toast「權限不足」（不導向）
- **member 介面收斂**：
  - `useNavItems` 依 role 過濾：member 無「銀行」（底部欄 4 tabs、側欄同步）
  - 帳單頁：member 僅「標記已繳」，隱藏編輯／刪除／重解析
  - 設定頁 member 版：安裝 App、Telegram 綁定卡（綁定／解綁／完成綁定流程）、行事曆訂閱卡（唯讀連結＋複製）、帳號卡（username、改密碼、登出）
- **admin 設定頁**：現有結構＋（a）Telegram 整合卡改 token-only、（b）帳號區加自己的 Telegram 綁定卡（與 member 同元件）、（c）使用者管理卡
- 改密碼 Dialog：舊密碼＋新密碼＋確認新密碼，成功 toast
- Telegram 綁定卡狀態機:未綁定（「綁定」→ 顯示深度連結按鈕＋「完成綁定」）／已綁定（顯示已綁定＋「解綁」）

### 6. 測試

- auth-flow 擴充：member 打 admin 路由 403、allow-list 路由 200；users CRUD（重複 username 409、刪 admin 400、刪 member 撤 session）；改密碼（錯舊密碼 401、成功後其他 session 失效、當前 session 存活）；per-username 鎖定（A 鎖不影響 B）
- setup 建立 admin User；initialized 判斷
- Telegram 綁定：mock fetch（getMe、getUpdates、sendMessage）測 bind→confirm 流程、過期碼 410、未命中 404
- broadcast fan-out：多使用者、同 chat id 去重、部分失敗仍 success
- 既有 27 個 server 測試維持通過；`pnpm --filter @bill-alarm/web generate` 通過

## 驗收

- 你（admin）登入：全功能不變；設定頁多使用者管理卡與自己的 TG 綁定卡
- 開家人帳號 → 家人登入：看到同一份帳單、可標記已繳、可觸發掃描看進度；無銀行 tab；設定頁僅帳號相關；打 admin API 得 403
- 家人點深度連結綁定 TG → 到期提醒所有已綁定者都收到、同群組不重複
- member 自行改密碼後其他裝置需重登；admin 可重設任何 member 密碼
- 升級部署後：全員重新登入一次，原帳密可用；原 telegram chat id（DB 設定者）自動成為 admin 綁定

## 部署注意

- 升級後需重新登入（sessions 清空）
- 若 chat id 原以 `TELEGRAM_CHAT_ID` env 設定：env 不再讀取，需由 admin 在 UI 重新綁定一次
- README 救援指令更新為對 `users` 表操作（清空 `users`＋`sessions` 回到 setup 狀態）
