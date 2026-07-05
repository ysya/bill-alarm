# Bill Alarm — 行動 App Shell＋PWA 安裝入口 設計

日期：2026-07-05
狀態：已核准（使用者確認「可以」）

## 背景與目標

PWA 已可安裝但無任何安裝引導；手機導航是「頂欄＋漢堡＋Sheet 抽屜」的純網頁模式，使用者反映「太 web」。目標：底部導航列取代漢堡（原生 app 慣例）、standalone 安全區處理、雙入口的 PWA 安裝引導。

**非目標**：各頁內容密度調整、下拉更新、頁面轉場動畫、桌面版任何變動、多語系。

## 設計

### 1. 底部導航列（`components/BottomNav.vue`）

- 手機（`<md`）固定底部：5 項與側欄相同（總覽／帳單／銀行／紀錄／設定），icon 在上、11px 標籤在下；NuxtLink `active-class` 主色高亮，非 active 為 muted。
- 外觀：`bg-background/85 backdrop-blur border-t`、列高 `h-14`、外層 `pb-safe`（safe-area-inset-bottom）、`z-50`、`md:hidden`。
- 觸控目標：每個 tab 佔滿等分寬、全高可點。

### 2. 殼改造（`app.vue`）

- 移除 Sheet／hamburger（`Menu` icon、sheet 相關 import 一併清除）。
- 手機頂欄：改顯示**當前頁標題**（由 route path 對 navItems 匹配，找不到則 `Bill Alarm`），置中或靠左皆可（靠左，同現在）；加 `pt-safe`（standalone 下瀏海不壓字），欄高不變。
- `main`：底部 padding 改 `pb-24 md:pb-8`（預留底部欄）＋既有 `mt-14 md:mt-0` 不變。
- navItems 抽出為 `composables/useNavItems.ts`（app.vue 側欄與 BottomNav 共用同一份）。
- `/login`、`/setup` 的 bareShell 路徑不渲染 BottomNav（既有 v-else 結構天然涵蓋）。

### 3. Safe-area utilities（`assets/css/main.css`）

不賭 UnoCSS arbitrary value 對 `env()` 的支援，直接加三個 utility：

```css
.pt-safe { padding-top: env(safe-area-inset-top); }
.pb-safe { padding-bottom: env(safe-area-inset-bottom); }
.mb-safe { margin-bottom: env(safe-area-inset-bottom); }
```

### 4. 安裝判斷（`composables/useInstallPrompt.ts`）

- `isStandalone`：`matchMedia('(display-mode: standalone)').matches || navigator.standalone === true`（後者為 iOS Safari 舊 API）。
- `isIos`：UA 含 iphone/ipad/ipod（單人 iPhone 情境，iPadOS 偽裝桌面版的邊角不處理，註記即可）。
- `$pwa`（@vite-pwa/nuxt 注入，可能為 undefined — 全程 optional chaining）：`canNativeInstall = !!$pwa?.showInstallPrompt`（Chromium 的 beforeinstallprompt 已捕獲）。
- `showEntry = !isStandalone && (canNativeInstall || isIos)`；其餘平台（桌面 Safari/Firefox）不顯示入口。
- `triggerInstall()`：canNativeInstall → `$pwa.install()`；否則（iOS）開啟引導 Dialog（狀態 `iosGuideOpen` 由 composable 持有，`useState` 全域單例，兩個入口共用同一個 Dialog）。
- Banner 關閉記憶：`localStorage['pwa-banner-dismissed'] = '1'`；`bannerVisible = showEntry && !dismissed`。

### 5. 安裝入口元件（`components/InstallPrompt.vue`）

Prop `variant: 'banner' | 'row'`：

- `banner`（總覽頁頂部）：低調一條 — Smartphone icon＋「把 Bill Alarm 安裝到主畫面，開啟更快」＋「安裝」按鈕＋X 關閉（記 localStorage）。`bannerVisible` 為 false 時不渲染。
- `row`（設定頁帳號區上方）：永久入口卡 —「安裝 App」標題＋說明＋「安裝／查看步驟」按鈕；`showEntry` 為 false（含已安裝）時不渲染。
- 元件內含 iOS 引導 `Dialog`（兩個 variant 共用 useState 狀態）：三步驟（1. Safari 分享按鈕 Share icon；2. 選「加入主畫面」；3. 確認），註明需使用 Safari 開啟。
- Chromium 路徑按鈕文字「安裝」，iOS 路徑「查看安裝步驟」。

### 6. 入口接線

- `pages/index.vue`：Page Header 之前插入 `<InstallPrompt variant="banner" />`。
- `pages/settings/index.vue`：帳號 section 的 Card 之前插入 `<InstallPrompt variant="row" />`。

## 驗收

- 手機視口（390px）：無漢堡；底部欄五項可導航、當前頁高亮；頂欄顯示當前頁標題；`main` 內容不被底部欄遮擋；無水平溢出。
- 桌面（1280px）：與現狀完全一致（側欄、無底部欄、無 banner 於桌面?—banner 與 row 依 showEntry 顯示，桌面 Chromium 有 beforeinstallprompt 也屬合理顯示，不特別禁止）。
- iPhone UA 模擬：總覽 banner 顯示 → 點擊開 iOS 引導 Dialog → 關閉 banner 後重整不再出現；設定頁 row 入口仍在。
- standalone（模擬或實機）：兩個入口都不渲染。
- `pnpm --filter @bill-alarm/web generate` 通過。
