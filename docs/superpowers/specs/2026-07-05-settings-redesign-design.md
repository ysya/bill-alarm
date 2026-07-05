# Bill Alarm — 設定頁重構（狀態卡片＋折疊）設計

日期：2026-07-05
狀態：已核准（使用者確認「可以，執行」）

## 背景與目標

設定頁現況（截圖驗證於 2026-07-05）：「服務整合」分頁四大段表單全展開直排，手機全頁超過四個螢幕高；段落層級弱（h3＋細線，帶框列反而更醒目）；儲存／測試按鈕散落且樣式不一；錯誤訊息裸紅字；登出鈕孤立頁尾；RWD 品質不佳（label+control 列在窄螢幕擠壓、URL 列溢出）。

參考業界模式（Immich 管理設定的折疊區塊＋狀態、GitHub/Slack integrations 的狀態卡片、shadcn settings 範例的行動單欄）：**狀態一眼可見、表單按需展開、動作位置統一**。

**目標**：設定頁改為狀態卡片＋折疊模式，行動優先；建立可供全站沿用的 RWD 模式。

**非目標**：auto-save、子頁路由、改密碼、其他頁面（bills/banks）的 RWD、API 或資料流變更。

## 設計

### 1. 頁面結構（拿掉 tabs，單頁三區）

```
設定（h1 + 副標）
├─ 服務整合（區標題）
│    SettingsCard ✉ 信箱（Gmail IMAP）……[Badge] ▸（收合）
│    SettingsCard 📅 行事曆訂閱（ICS Feed）[Badge] ▸
│    SettingsCard ✈ Telegram……………………[Badge] ▸
│    SettingsCard ✦ AI 解析器…………………[Badge] ▸
├─ 通知規則（區標題；清單直接顯示，不收合；含新增按鈕）
└─ 帳號（區標題；卡片：登入身分 username ＋ 登出按鈕）
```

- Tabs（服務整合／通知規則）移除；`activeTab` 狀態刪除。
- 各區之間以區標題（`h2` 級樣式）分隔，不再用 `<Separator>` 當主要分界。

### 2. SettingsCard 元件（新增 `components/settings/SettingsCard.vue`）

可折疊狀態卡，所有整合區塊共用：

- **Props**：`icon`（component）、`title`、`status`（`'ok' | 'unset' | 'error'`）、`statusText?`（badge 文字覆寫，預設 已設定／未設定／錯誤）、`defaultOpen?`（預設 false）。
- **標題列**：圖示＋標題＋狀態 Badge＋展開 chevron（旋轉動畫）；整列可點切換展開；高度 ≥ 44px（觸控目標）。
- **狀態 Badge**：`ok`＝綠（現有 green dot 色系）、`unset`＝muted、`error`＝destructive。
- **內容區**：`<Collapsible>` 包裹 slot（各 Integration 元件的表單內容）。
- 基於 shadcn-vue 的 `Card` ＋ `Collapsible`（後者需新增）。

### 3. 各整合元件的改造

四個 Integration 元件（Email／Calendar／Telegram／LLM）：

- 移除各自的 `h3` 標題列與狀態 dot（上移到 SettingsCard 標題列；狀態值由 index.vue 依既有 `configStatus` 計算後以 props 傳入 SettingsCard）。
- **錯誤呈現**：裸紅字（如信箱「連線失敗：…」）改用新增的 `Alert`（destructive variant）元件，置於卡片內容頂端。
- **動作列統一**：每張卡表單底部一條動作列 — 主要「儲存」`Button`（default variant）靠右；次要「測試連線」等（outline variant）靠左；`flex flex-wrap gap-2 justify-between`。段內散落的儲存鈕（如掃描範圍列內嵌的儲存）合併進表單自身的儲存流程或保留就地但樣式統一（size sm outline）——以不改變 API 呼叫粒度為原則。
- 表單內部欄位與邏輯（API 呼叫、驗證、測試流程）不變。

### 4. 帳號卡（新增區塊，收編登出）

- 內容：「登入身分：`{username}`」（來源 `GET /api/auth/me`）＋「登出」按鈕（destructive outline，非滿版紅）。
- 頁尾孤兒登出鈕移除。

### 5. RWD 修正（設定頁範圍）

- `ConfigRow`：`sm` 以下改上下堆疊（`flex-col`），控制項全寬；`sm` 以上維持左右。
- ICS 訂閱網址：input＋複製鈕在窄螢幕直排（`flex-col sm:flex-row`）。
- 所有按鈕列 `flex-wrap`。
- 觸控目標（卡片標題列、開關、按鈕）≥ 44px。
- 驗證視口:390px（iPhone）與 1280px。

### 6. 新增 ui 元件

- `collapsible`、`alert` 由 shadcn-vue CLI 加入 `components/ui/`（自動生成目錄，遵守「不手改 ui/」慣例；若 CLI 與現有版本不相容，依既有 ui 元件檔案風格 vendor）。

## 驗收

- 設定頁初載＝全部收合：一屏內可見所有服務狀態 Badge ＋ 通知規則清單入口（手機 390px）。
- 每張卡展開後可完成原有全部操作（儲存、測試、複製、rotate、規則 CRUD），行為與 API 呼叫不變。
- 錯誤狀態：badge 紅 ＋ 展開後 Alert 顯示原因；無裸紅字。
- 手機 390px 無水平溢出；`pnpm --filter @bill-alarm/web generate` 通過。
- 截圖對比（改造前截圖已存）。
