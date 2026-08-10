# 通知與授權 UX 重整設計

- 日期：2026-08-11
- 狀態：已核可（brainstorming 三段設計均經使用者確認）
- 範圍：前後端皆可動（含 Prisma schema 與 migration）

## 背景與問題

專案將開源給他人自架，但目前通知與授權相關 UX 有四個確認過的痛點：

1. **Telegram 三處分散**：Bot Token（系統管理）、個人綁定（帳號區）、規則頻道（通知規則）三個地方互相依賴，但依賴鏈在介面上是隱形的；缺任何一環通知就靜默失敗，錯誤只寫進 `NotificationLog`，介面看不到。
2. **通知規則過重**：要命名規則、要選頻道但實際只剩 Telegram 一個選項；「新帳單通知」與「逾期警告」是寫死的內建行為，規則管不到，介面也沒提。
3. **行事曆與通知脫節**：ICS 行事曆其實也是提醒管道（事件內建到期前 1 天／1 小時提醒），卻歸在「服務整合」，與通知規則是兩套心智模型。
4. **信箱授權流程混雜**：App Password 表單、測試連線、「立即掃描」擠在同一張卡，一次性授權與日常操作混在一起。

## 目標

- 陌生管理員能從零設定到收到第一則通知，過程不需查文件。
- 「我會不會收到提醒」的所有答案集中在同一個地方，依賴鏈（Bot → 綁定 → 偏好）可見、可導航。
- 通知送達失敗從靜默變成可見。
- 通知設定的心智模型從「多條具名規則」簡化為「單一偏好面板」。

## 非目標（明確不做）

- 首次設定 wizard（常駐進度卡已覆蓋引導價值）。
- Email 或多頻道通知架構（「頻道」概念從 UI 消失；`NotificationLog.channel` 欄位保留）。
- 獨立的通知歷史頁（`lastDelivery` 狀態列＋既有掃描紀錄頁已足夠）。
- 前端測試框架（維持 typecheck＋lint）。

## 1. 設定頁資訊架構

分區原則：按「使用者的問題」分組，不按技術類別。

```
設定
├─ 通知 ——「我會不會收到提醒？」
│   ├─ 通知偏好面板（見 §3）
│   ├─ 送達方式 Telegram（見 §4，自帳號區遷入）
│   └─ 行事曆訂閱 ICS（見 §5，自服務整合遷入）
├─ 資料來源 ——「帳單怎麼進來？」（原「服務整合」更名拆分）
│   ├─ 信箱授權（IMAP，見 §6）
│   └─ 掃描（見 §6，新卡）
├─ 帳號：PWA 安裝、登入身分（改密碼／登出）
└─ 系統管理（admin）：Telegram Bot、AI 解析器、掃描排程、使用者管理（見 §7）
```

各區塊加上錨點 id（如 `#notifications`、`#data-source`、`#system`）供深連結使用。

## 2. 儀表板設定進度卡

取代現在只提信箱的「還差一步」提示卡：

```
┌ 完成設定，開始自動追蹤帳單 ────────────┐
│ ✓ 1. 連接信箱                          │
│ ✓ 2. 啟用你的銀行                      │
│ ○ 3. 打開 Telegram 通知 → [去綁定]     │
└────────────────────────────────────────┘
```

- 三步條件：① `emailConfigured`（imapUser＋imapPassword 皆存在）② `hasActiveBank`（至少一家啟用中銀行）③ `botConfigured && telegramBound`。通知偏好有預設值，不列為步驟。
- 每個未完成步驟附深連結；admin 的第 3 步區分「缺 Bot Token」（連到系統管理）與「缺個人綁定」（連到通知區）；成員在 Bot 未設定時顯示「等待管理員設定 Bot」。
- 三步全 ✓ 後整張卡消失；狀態載入完成前不渲染（避免閃爍，沿用現有 hint 的防閃策略）。

**新端點** `GET /api/onboarding-status`（self-scoped，掛在 `routes/integrations.ts`）：

```json
{ "emailConfigured": true, "hasActiveBank": true, "botConfigured": true, "telegramBound": false }
```

純 DB 查詢，不做 IMAP live probe。

## 3. 通知偏好（取代通知規則）

### 資料模型

```prisma
model NotificationPreference {
  id            String  @id @default(uuid(7))
  userId        String  @unique
  user          User    @relation(fields: [userId], references: [id], onDelete: Cascade)
  remindDays    String  @default("[3,1]")  // JSON int array，如 [7,3,1]，空陣列＝關閉到期提醒
  remindTime    String  @default("09:00")  // HH:mm
  notifyNewBill Boolean @default(true)
  notifyOverdue Boolean @default(true)
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  @@map("notification_preferences")
}
```

- `NotificationRule` 整表刪除。
- `NotificationLog` 移除 `ruleId` 欄位與關聯；歷史紀錄與 `message` 內容保留。

### 預設值與 fallback 不變量

預設值（`[3,1]`、`09:00`、兩開關 true）定義為 server 端單一常數。**偏好列允許不存在**：GET、排程器讀不到列時一律以同一組預設值運作；列在首次 GET／PUT 時 lazy 建立。因此新建使用者零設定即有完整通知行為。

### Migration（一次性 SQL）

1. 建立 `notification_preferences` 表。
2. 只為「至少有一條規則」的使用者物化資料列：
   - 有啟用中規則 → `remindDays` = 啟用規則 `daysBefore` 的聯集（去重、由大到小排序）；`remindTime` = 啟用規則中最早的 `timeOfDay`（多時間合併為一，是模型簡化的已知代價）。
   - 規則全部停用 → `remindDays = "[]"`（尊重使用者刻意關閉的狀態）。
   - `notifyNewBill`／`notifyOverdue` 一律 true（保留現行寫死行為）。
3. 從未建過規則的使用者不物化資料列，由 fallback 提供預設（等同升級後預設開啟 `[3,1]` 提醒——已與使用者確認接受）。
4. 刪除 `notification_rules` 表；重建 `notification_logs`（去掉 `ruleId`）。

### API

- `GET /api/notification-prefs`：回偏好＋`lastDelivery`（該使用者名下帳單最近一筆 `NotificationLog`：`sentAt`、`success`、`message`、`errorMessage`，無則 null）。無資料列時以預設值 lazy 建立。
- `PUT /api/notification-prefs`：驗證 `remindDays` 為 0–30 整數、去重、最多 6 個；`remindTime` 符合 `HH:mm`。
- 規則 CRUD 端點、對應 composables 與 DTO 移除（路由檔由 `notification-rules.ts` 改為 `notification-prefs.ts`，與 §10 一致）。

### 排程行為（沿用 15 分鐘 tick 與自癒邏輯）

- **到期提醒**：每 tick 對每位（未刪除）使用者：`hhmm >= remindTime` 才處理；對 `remindDays` 中每個 `d` 找 `dueDate = today + d` 的 PENDING 帳單（排除 autoDebit）發送。去重 key 改為「`billId`＋當日＋`message = 到期提醒 D-${d}`＋success」；同一帳單同一天只會命中一個 `d`，安全。
- **新帳單通知**：發送前檢查 owner 偏好的 `notifyNewBill`（無列＝true）。
- **逾期警告**：發送前檢查 owner 偏好的 `notifyOverdue`（無列＝true）。

### 面板 UI

- 天數 chips：可點 ✕ 移除、「＋」新增（快捷 7／3／1＋自訂 0–30）；移除到空陣列＝關閉到期提醒，面板顯示對應空狀態文案。
- 時間：`type="time"` input；兩個開關：新帳單通知、逾期警告。
- **改動即存**：debounced（約 500ms）PUT＋toast；失敗時 toast 錯誤並 refetch 回同步。無「儲存」按鈕。
- 面板頂部**送達狀態列**：成功「上次發送：8/10 09:00 ✓」；失敗「⚠ 上次發送失敗：使用者未綁定 Telegram」。
- Telegram 未綁定或 Bot 未設定時，面板內顯示警示條指向下方送達方式卡（成員在 Bot 未設定時顯示「請聯絡管理員」文案）。

## 4. Telegram 送達方式卡（通知區）

三種狀態：

1. **Bot 未設定**：成員 →「管理員尚未設定 Telegram Bot，通知暫時無法送達」；admin → 同訊息＋「前往設定 Bot」深連結。
2. **Bot 已設定、未綁定**：「綁定 Telegram」→ 產生 deepLink 後顯示「開啟 Telegram」按鈕，前端**自動輪詢** confirm 端點（每 3 秒、上限 2 分鐘）：
   - 成功 → 自動翻成已綁定＋toast。
   - 410（code 過期）→ 回初始狀態，提示重新產生。
   - 超時 → 顯示「還沒偵測到，按過 Start 後可重試」＋手動重試按鈕。
   - 輪詢中的暫時性網路錯誤靜默重試，不 toast 轟炸。
   - 原「完成綁定」手動按鈕移除。實作時確認 confirm 路由對 `not_seen` 的回應碼適合輪詢判別（與 `ok`／`410` 可區分即可）。
3. **已綁定**：✓ 狀態＋「發送測試訊息」（沿用 `/telegram/test`，本就開放全員）＋「解除綁定」。

## 5. 行事曆卡（通知區）

功能沿用（訂閱網址＋複製＋教學 dialog＋rotate token）。文案重寫定位：「另一種提醒方式：把到期日放進你的日曆，事件內建到期前 1 天／1 小時提醒」，與 §3 偏好面板互補。

## 6. 資料來源

- **信箱授權卡**：未授權＝現有表單＋App Password 教學 dialog；已授權＝一行狀態列（email＋連線 badge＋「修改授權」展開表單）。「立即掃描」自此卡移除。
- **掃描卡（新）**：「立即掃描」＋SSE live 進度（沿用 `useScanEvents`）＋上次掃描摘要（最近一筆 `ScanLog`：時間、掃描數、新帳單數、錯誤數）＋「查看掃描紀錄」連結。信箱未授權時 disabled 並提示；無啟用中銀行時提示先去銀行頁。實作時確認 scan-logs 既有 API 可取最新一筆（不行就加 `limit` 參數）。

## 7. 系統管理（admin）

- **Telegram Bot 卡**：保留 Token 設定與已綁定人數；文案強調「全系統設一次，成員各自到『通知』區綁定」；移除此處「發送測試（給自己）」（已搬到 §4，避免同功能兩處）。
- AI 解析器、掃描排程（全域 interval／range）、使用者管理維持不動。

## 8. 錯誤處理原則

所有「送不出去」的狀態都要有可見出口，且指向可行動的下一步：

| 狀態 | 浮出位置 |
| --- | --- |
| 上次發送失敗（含未綁定） | §3 送達狀態列 |
| Bot 未設定／未綁定 | §4 卡片狀態＋§3 警示條＋§2 進度卡第 3 步 |
| 信箱未授權／連線失敗 | §6 授權卡＋§2 進度卡第 1 步 |
| 無啟用中銀行 | §6 掃描卡提示＋§2 進度卡第 2 步 |

## 9. 測試

- Server（沿用既有測試模式）：
  - prefs GET／PUT 驗證與 lazy 建立、self-scoping。
  - 排程三種通知遵守偏好開關；無資料列時 fallback 預設；去重 key 行為。
  - Migration 三情境轉換：有啟用規則／全停用／零規則。
  - `onboarding-status` 權限與四布林正確性。
  - confirm 綁定語意不變（輪詢重複呼叫冪等）。
- Web：typecheck＋lint。

## 10. 影響檔案（實作定位用，非窮舉）

- Server：`prisma/schema.prisma`＋migration、`routes/notification-rules.ts`→`routes/notification-prefs.ts`、`routes/integrations.ts`（onboarding-status）、`services/notification.ts`、`packages/shared/types.ts`（DTO 汰換）。
- Web：`pages/settings/index.vue`（重分區）、`pages/index.vue`（進度卡）、`components/settings/`（NotificationPrefsCard 新增；TelegramBindCard 改造為送達方式卡；IntegrationEmail 拆分；ScanCard 新增；IntegrationTelegram／IntegrationCalendar 文案調整；NotificationRuleList／NotificationRuleDialog 刪除）、`composables/useSettingsApi`、`types/settings.ts`（CHANNEL_OPTIONS 刪除）。
