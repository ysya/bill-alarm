# 核心功能 UX 重整設計（總覽／帳單／銀行／導覽）

- 日期：2026-08-11
- 狀態：已核可（brainstorming 兩段設計均經使用者確認；細節授權自行決定）
- 範圍：前後端皆可動；延續 v0.4.0 的通知/授權 UX 重整
- 參考模式：一鍵完成＋Undo toast（Todoist／Gmail 封存模式）；單一待辦流（帳單類 App 的 upcoming-bills 模式）

## 背景與問題（探索確認的六個摩擦點）

1. **「標記已繳」三入口兩行為**：總覽一鍵直標（無日期、無確認、無復原）；列表與詳情開日期 Dialog。誤點只能進詳情頁救。
2. **掃描入口重複**：帳單頁「掃描信件」按鈕自帶一套舊文案邏輯（Gmail 時代錯誤訊息），與 v0.4.0 設定掃描卡並存；掃完僅帳單頁自動刷新。
3. **總覽資訊重複、時間語意分裂**：「繳費時程」與「待繳帳單」呈現同一份資料；summary 卡不可點；月份選擇器只影響上半部，下方列表永遠全量。
4. **帳單列表**：「待繳」tab 不含逾期；「全部」tab 的 badge 顯示當前 tab 筆數（語意錯誤）；空狀態無引導。
5. **詳情頁**：編輯模式的狀態下拉與「標記已繳」按鈕形成兩條改狀態路徑；通知紀錄 channel 顯示原始字串。
6. **導覽與銀行頁**：低頻的「紀錄」佔主導覽五格之一；「銀行帳戶」進階功能佔銀行頁一級版面。

## 目標

- 高頻動作（看接下來要繳什麼、標記已繳）一步到位且可反悔。
- 同一個動作在所有入口行為一致、文案一致。
- 總覽一頁只有一種時間語意：上方＝當下事實，月度區＝所選月份。

## 非目標（明確不做）

- 搜尋／銀行維度篩選（資料量小，tabs 足夠）。
- 帳單手動新增（資料來源是掃描＋解析，維持）。
- 銀行頁內建/自訂 section 的結構改動（只動銀行帳戶區）。
- scan-logs 頁面內容改版（只調整入口）。

## 0. Codex 審查後修訂（2026-08-11）

外部審查（Codex）提出 18 項建議，逐條驗證後採納如下（未採納者附理由於 §10）：

- **繳費日可見化**：一鍵已繳的 toast 明示「繳費日：今天」，description 註明可至詳情頁修改；`markAsPaid` 只寫 `paidAt`、絕不動 `dueDate`（現行為，明文化）。
- **autoDebit 按鈕語意**：autoDebit 帳單的按鈕文字改「確認已扣款」（一般帳單「已繳」），不新增中間狀態。
- **Undo 時窗**：已繳 toast `duration: 8000`；sonner 為 app 層級、跨頁保留；toast 消失後的永久復原路徑＝詳情頁「恢復為待繳」（本已存在，明文化）。多筆連續標記時 sonner 自然堆疊、各自帶復原（實作時驗證）。
- **未繳分段**：未繳 tab 與總覽待辦流都分「已逾期（N）」／「即將到期（N）」兩段（未繳 tab 以此取代帳期分組；其他 tab 維持帳期分組）。逾期列顯示「逾期 N 天」紅字（DaysRemaining 已有此行為）。
- **待辦流收斂**：總覽顯示全部逾期＋最近到期前 5 筆，其餘收成「查看另外 N 筆未繳 →」連到 `/bills?tab=unpaid`。
- **summary 卡導覽語意**：卡片加 ChevronRight 與 hover/focus 樣式；文案「目前待繳（含 N 筆逾期）」「本月已繳」「逾期」。已繳 tab 排序改繳費日新→舊，登陸頁最近繳的在最上。
- **總覽空狀態分層**：`emailConfigured === false` 時不顯示 🎉 慶祝空狀態（上方進度卡已是 CTA），改中性文案「完成設定後帳單會自動出現」；已設定且真的零未繳才慶祝。
- **各 tab 排序明文化**：未繳＝dueDate 升冪；已繳＝paidAt 降冪；免繳與全部＝dueDate 降冪（新帳單在前）。
- **「不需繳費」正名與救回路徑**：tab 改名「免繳」，空狀態附定義「本期無需繳款的帳單（如零元帳單）」；`NO_PAYMENT` 帳單的詳情頁提供「改為待繳」按鈕（單一轉換動作，不重開狀態下拉）。
- **掃描漏件出口**：總覽待辦流底部與帳單頁空狀態加「找不到某張帳單？查看掃描紀錄」連結（`/scan-logs`）。
- **一鍵按鈕 a11y**：「已繳」按鈕 `aria-label` 含銀行名；列點擊與按鈕維持獨立目標（`@click.stop` 現行模式）。

## 1. 總覽（單一待辦流）

由上而下：

1. `InstallPrompt`＋`OnboardingProgressCard`（不變）。
2. **三張可點 summary 卡**：
   - 待繳總額（副標「N 筆」；含逾期；不分月）→ `/bills?tab=unpaid`
   - 本月已繳（固定日曆當月）→ `/bills?tab=paid`
   - 逾期（不分月）→ `/bills?tab=unpaid`（逾期置頂即可見）
   - 原「待繳帳單數」卡取消，數字併入待繳總額副標。
3. **「接下來要繳」列表**（取代「繳費時程」＋「待繳帳單」網格）：
   - 內容＝全部未繳（pending＋overdue），排序＝dueDate 升冪（逾期日期較早自然置頂）。
   - 每列：銀行名、autoDebit badge、金額、`DaysRemaining`、「已繳」鈕（一鍵直標，見 §2；autoDebit 帳單同樣有此鈕）。點列進詳情。
   - 空狀態：「目前沒有未繳帳單 🎉」。
4. **月度明細**（按銀行加總，原 breakdown）＋月份選擇器；**選擇器只作用於此區**。

### API 語意調整

`GET /bills/summary`（現 `getSummary(month)`）拆語意：`totalPending`／`pendingCount`／`overdueCount` 改為**不分月**的當下值；`paidCount` 為**日曆當月**（與月份參數無關）；`breakdown` 維持依月份參數。`timeline` 欄位廢除（前端不再用）。實作時依現有 route 結構調整並更新測試；若現有欄位已是此語意則僅刪 timeline。

## 2. 一鍵已繳＋Undo（全入口統一）

- 新 composable `useMarkPaid()`：`markPaid(bill, onChanged)` → 呼叫既有 `markAsPaid(id)`（繳費日＝今天）→ 成功 toast「已標記 {銀行} 已繳」附 **「復原」** action（呼叫既有 `unpay(id)` 後執行 onChanged 並 toast「已復原」）。
- 總覽「接下來要繳」、帳單列表、詳情頁三處共用；列表與詳情的**日期 Dialog 刪除**。
- 回填非今日繳費日：詳情頁「編輯」模式在已繳狀態下顯示「繳費日」date 欄位；伺服器 `PATCH /bills/:id` 若不支援 `paidAt` 則擴充（驗證為合法日期、只在 status=paid 時接受）＋測試。

## 3. 掃描收斂

- 新 composable `useScanTrigger()`：抽取 v0.4.0 `ScanCard` 的 triggerScan＋toast 邏輯（含「查看紀錄」action）為單一出處。
- `ScanCard` 與帳單頁「掃描信件」按鈕都改用它；帳單頁的舊 handleScan（Gmail 文案）刪除。
- 總覽訂閱 `useScanEvents().onComplete` → 刷新 summary 與待辦流（目前僅帳單頁刷新）。
  - 注意：`onComplete` 目前是單一 ref callback（後註冊者覆蓋先註冊者），改為支援多訂閱者（callback set）以免總覽與帳單頁互踩。

## 4. 帳單列表

- Tabs：**全部／未繳／已繳／不需繳費**（「逾期」獨立 tab 移除）。
- 伺服器 `GET /bills` 支援 `status=unpaid` ＝ `IN (pending, overdue)`；排序維持現行（實作時確認為 dueDate 升冪，若非則指定）＋測試（含分頁）。
- Tab 數字 badge 移除（分頁列「共 N 筆」已足）。
- `?tab=` query 深連結：載入時還原、切換時寫回 URL（`router.replace`，不進 history）。合法值 `all|unpaid|paid|no_payment`，非法值落回 `all`。
- 空狀態引導：list 為空且 `onboarding.emailConfigured === false` → 「先到設定完成信箱授權，帳單會自動掃進來」＋連結 `/settings#data-source`；否則依 tab 給文案（未繳：「沒有未繳帳單 🎉」；其餘維持中性文案）。

## 5. 詳情頁

- 編輯模式**移除「狀態」Select**——狀態變更只走「標記已繳／恢復為待繳」按鈕（單一路徑）。`NO_PAYMENT` 等罕見修正場景接受不可自助（YAGNI）。
- 已繳狀態的編輯模式新增「繳費日」欄位（date input，送 `paidAt`）。
- 「標記已繳」改走 `useMarkPaid()`（§2），日期 Dialog 刪除。
- 通知紀錄 channel 顯示映射：`telegram` → `Telegram`（其他值原樣）。

## 6. 銀行頁與導覽

- **銀行帳戶區降級**：移到頁面最底部，改用 `Collapsible`（預設收起）標題「進階：銀行帳戶歸類」，說明「把多家銀行歸到同一實體帳戶，純標記用」。功能不變。
- **主導覽**：`useNavItems` 移除「紀錄」→ 四格（總覽／帳單／銀行／設定）。scan-logs 頁保留路由，入口＝設定掃描卡「查看掃描紀錄」＋掃描 toast「查看紀錄」action。

## 7. 錯誤處理原則

- Undo 失敗（unpay 錯誤）→ toast 錯誤並觸發 onChanged 刷新，讓畫面回到伺服器真實狀態。
- 一鍵已繳的並發防護：同一帳單標記中時按鈕 disabled（沿用現有 markingPaid Set 模式，移入 composable）。
- 深連結非法 `?tab=` 靜默落回 `all`，不報錯。

## 8. 測試

- Server：`status=unpaid` 過濾與排序、summary 語意（不分月待繳/逾期、當月已繳、timeline 移除）、`PATCH paidAt` 驗證（合法日期、非 paid 狀態拒絕）。既有 bills 測試同步更新。
- Web：typecheck＋lint＋build；煙霧測試（總覽三卡跳轉、一鍵已繳＋復原、掃描後自動刷新、?tab= 還原）。

## 9. Codex 建議未採納項目與理由

- **本月已繳卡連結帶月份篩選**：不做月份 query 機制；已繳 tab 改 paidAt 降冪後當月自然置頂，登陸誤差可接受（部分採納）。
- **帳單頁預設 tab 改未繳**：角色分工明確化——總覽＝行動中心、帳單＝完整帳簿，預設「全部」合理，維持。
- **手動新增帳單／占位提醒**：維持非目標；以掃描紀錄出口＋重掃補救。資料來源單一是本產品的定位。
- **多幣別**：資料模型單一幣別（TWD 整數、解析器僅台灣銀行），加總無幣別歧義；於本節明文假設，不改 UI。
- **時區設定**：伺服器已固定 `TZ=Asia/Taipei`（Dockerfile），dueDate 為日曆日字串；客戶端「今天」採裝置時區，目標族群（台灣）下誤差可忽略，不新增時區設定。
- **更細的時間分組（今天/7天內/稍後）**：已逾期／即將到期兩段已足，資料量小再細分是噪音。

## 10. 影響檔案（定位用）

- Server：`routes/bills.ts`（list unpaid、summary、PATCH paidAt、各 tab 排序）＋ `routes/__tests__/`。
- Web：`pages/index.vue`（重寫主體）、`pages/bills/index.vue`（tabs/badge/query/空狀態/掃描按鈕）、`pages/bills/[id].vue`（編輯模式、useMarkPaid、channel label）、`composables/useMarkPaid.ts`（新）、`composables/useScanTrigger.ts`（新）、`composables/useScanEvents.ts`（onComplete 多訂閱）、`components/settings/ScanCard.vue`（改用 useScanTrigger）、`components/banks/BankAccountSection.vue`＋`pages/banks/index.vue`（收合降級）、`composables/useNavItems.ts`（移除紀錄）、`components/DaysRemaining.vue`（沿用）。
- shared：`MonthlySummaryDTO`（timeline 移除）。
