# 行動 App Shell＋PWA 安裝入口 實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 手機導航改為底部分頁列（去漢堡）、standalone 安全區處理、PWA 安裝雙入口（總覽 banner＋設定固定列，iOS 引導 Dialog / Chromium 原生安裝）。

**Architecture:** navItems 抽成共用 composable；新 `BottomNav` 元件＋`app.vue` 殼改造；`useInstallPrompt` composable 集中安裝狀態判斷（standalone／iOS／Chromium `$pwa`），`InstallPrompt` 元件以 variant 呈現 banner 與 row 兩種入口、共用一個 iOS 引導 Dialog（useState 全域狀態）。桌面版零變動。

**Tech Stack:** Nuxt 4 SPA、@vite-pwa/nuxt 的 `$pwa` 注入（`showInstallPrompt`／`install()`）、UnoCSS＋main.css 手寫 safe-area utilities、shadcn-vue（Card/Button/Dialog 既有）。

**Spec:** `docs/superpowers/specs/2026-07-05-mobile-shell-design.md`

## Global Constraints

- UI 文案繁體中文（台灣）；程式碼與 commit 英文、conventional commits。ESLint：無分號、單引號。
- `components/ui/` 不可手改。lucide 圖示自 `lucide-vue-next`。ui 元件在頁面／元件中明確 import。
- 桌面（`md` 以上）視覺與行為零變動；`/login`、`/setup` 不出現底部欄。
- `$pwa` 可能為 `undefined`（PWA 模組停用或極舊瀏覽器）— 一律 optional chaining，且判斷都包在 client 端（`ssr: false`，可直接使用 window/navigator，但仍須防 undefined）。
- 每個 Task 完成前：`pnpm --filter @bill-alarm/web generate` 成功；touched 檔案 eslint 無「新增」錯誤（既有 debt 用 stash 比對法證明）。
- 指令於 repo root 執行：`/Users/ysya/project/homelab/bill-alarm`。

---

### Task 1: safe-area utilities＋useNavItems＋BottomNav＋app.vue 殼改造

**Files:**
- Modify: `apps/web/assets/css/main.css`（附加三個 utility）
- Create: `apps/web/composables/useNavItems.ts`
- Create: `apps/web/components/BottomNav.vue`
- Modify: `apps/web/app.vue`

**Interfaces:**
- Produces: `useNavItems(): { to: string, label: string, icon: Component }[]`（五項，順序：總覽 `/`、帳單 `/bills`、銀行 `/banks`、紀錄 `/scan-logs`、設定 `/settings`）；`<BottomNav />`（無 props）。

- [ ] **Step 1: main.css 附加**

`apps/web/assets/css/main.css` 檔尾加：

```css
/* Safe-area utilities for standalone PWA (viewport-fit=cover) */
.pt-safe { padding-top: env(safe-area-inset-top); }
.pb-safe { padding-bottom: env(safe-area-inset-bottom); }
.mb-safe { margin-bottom: env(safe-area-inset-bottom); }
```

- [ ] **Step 2: 建 `apps/web/composables/useNavItems.ts`**

```ts
import type { Component } from 'vue'
import { CreditCard, History, LayoutDashboard, Receipt, Settings } from 'lucide-vue-next'

export interface NavItem {
  to: string
  label: string
  icon: Component
}

export function useNavItems(): NavItem[] {
  return [
    { to: '/', label: '總覽', icon: LayoutDashboard },
    { to: '/bills', label: '帳單', icon: Receipt },
    { to: '/banks', label: '銀行', icon: CreditCard },
    { to: '/scan-logs', label: '紀錄', icon: History },
    { to: '/settings', label: '設定', icon: Settings },
  ]
}
```

（注意：底部欄空間有限，`掃描紀錄` 標籤縮為 `紀錄`；桌面側欄沿用同一份 — 側欄顯示「紀錄」可接受，統一即可。）

- [ ] **Step 3: 建 `apps/web/components/BottomNav.vue`**

```vue
<script setup lang="ts">
const navItems = useNavItems()
</script>

<template>
  <nav class="md:hidden fixed bottom-0 left-0 right-0 z-50 border-t border-border bg-background/85 backdrop-blur pb-safe">
    <div class="flex h-14 items-stretch">
      <NuxtLink
        v-for="item in navItems"
        :key="item.to"
        :to="item.to"
        class="flex flex-1 flex-col items-center justify-center gap-0.5 text-muted-foreground transition-colors"
        active-class="text-primary"
      >
        <component :is="item.icon" class="h-5 w-5" />
        <span class="text-[11px] leading-none">{{ item.label }}</span>
      </NuxtLink>
    </div>
  </nav>
</template>
```

注意 NuxtLink 對 `/` 的 active 判斷：預設 `active-class` 在 `/bills` 時 `/` 也算 active（前綴匹配）— 總覽項需加 `exact-active-class` 或以 `:class="route.path === '/' ? ..."` 處理。實作採：總覽那項改用 `exact` 行為 — NuxtLink 無 exact prop（Vue Router 4），正確做法：全部改用手動 class 綁定：

```vue
<script setup lang="ts">
const navItems = useNavItems()
const route = useRoute()

function isActive(to: string): boolean {
  return to === '/' ? route.path === '/' : route.path.startsWith(to)
}
</script>

<template>
  <nav class="md:hidden fixed bottom-0 left-0 right-0 z-50 border-t border-border bg-background/85 backdrop-blur pb-safe">
    <div class="flex h-14 items-stretch">
      <NuxtLink
        v-for="item in navItems"
        :key="item.to"
        :to="item.to"
        class="flex flex-1 flex-col items-center justify-center gap-0.5 transition-colors"
        :class="isActive(item.to) ? 'text-primary' : 'text-muted-foreground'"
      >
        <component :is="item.icon" class="h-5 w-5" />
        <span class="text-[11px] leading-none">{{ item.label }}</span>
      </NuxtLink>
    </div>
  </nav>
</template>
```

（以此版為準。）

- [ ] **Step 4: app.vue 改造**

script：移除 `Menu` 與 Sheet 系列 import 及 `Button` import（若僅漢堡使用）；navItems 改 `const navItems = useNavItems()`；加：

```ts
const pageTitle = computed(() => {
  const hit = navItems.find(item =>
    item.to === '/' ? route.path === '/' : route.path.startsWith(item.to),
  )
  return hit?.label ?? 'Bill Alarm'
})
```

template：

(a) Mobile Header 整塊（原 22–51 行）換為：

```vue
      <!-- Mobile Header -->
      <div class="md:hidden fixed top-0 left-0 right-0 z-50 bg-background/85 backdrop-blur border-b border-border pt-safe">
        <div class="flex items-center px-4 h-14">
          <h1 class="text-lg font-bold">{{ pageTitle }}</h1>
        </div>
      </div>
```

(b) main（原 54 行）：`class="flex-1 p-6 md:p-8 mt-14 md:mt-0 min-h-screen"` → `class="flex-1 p-4 pb-24 md:p-8 md:pb-8 mt-14 md:mt-0 min-h-screen"`（手機內距同步縮為 p-4 更貼近 app；桌面不變）。

(c) `</main>` 之後、`</div>`（v-else 區塊結尾）之前加 `<BottomNav />`。

- [ ] **Step 5: 建置＋lint＋commit**

```bash
pnpm --filter @bill-alarm/web generate
cd apps/web && npx eslint app.vue components/BottomNav.vue composables/useNavItems.ts && cd ../..
git add apps/web/assets/css/main.css apps/web/composables/useNavItems.ts apps/web/components/BottomNav.vue apps/web/app.vue
git commit -m "feat(web): bottom tab navigation replacing mobile drawer, safe-area utilities"
```

---

### Task 2: useInstallPrompt＋InstallPrompt（banner／row／iOS 引導）

**Files:**
- Create: `apps/web/composables/useInstallPrompt.ts`
- Create: `apps/web/components/InstallPrompt.vue`

**Interfaces:**
- Produces:
  - `useInstallPrompt(): { showEntry: ComputedRef<boolean>, bannerVisible: ComputedRef<boolean>, canNativeInstall: ComputedRef<boolean>, isIos: boolean, iosGuideOpen: Ref<boolean>, triggerInstall: () => Promise<void>, dismissBanner: () => void }`
  - `<InstallPrompt variant="banner" />`／`<InstallPrompt variant="row" />`

- [ ] **Step 1: 建 `apps/web/composables/useInstallPrompt.ts`**

```ts
const DISMISS_KEY = 'pwa-banner-dismissed'

export function useInstallPrompt() {
  const nuxtApp = useNuxtApp()
  // @vite-pwa/nuxt injection — undefined when the PWA module is disabled
  const pwa = nuxtApp.$pwa as undefined | {
    showInstallPrompt?: boolean
    install?: () => Promise<void>
  }

  const isStandalone = window.matchMedia('(display-mode: standalone)').matches
    // iOS Safari legacy flag
    || (navigator as { standalone?: boolean }).standalone === true

  // Single-user iPhone context; desktop-UA iPads are out of scope.
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent)

  const canNativeInstall = computed(() => !!pwa?.showInstallPrompt)
  const showEntry = computed(() => !isStandalone && (canNativeInstall.value || isIos))

  const dismissed = useState('pwa-banner-dismissed', () => {
    try {
      return localStorage.getItem(DISMISS_KEY) === '1'
    }
    catch {
      return false
    }
  })
  const bannerVisible = computed(() => showEntry.value && !dismissed.value)

  const iosGuideOpen = useState('pwa-ios-guide-open', () => false)

  async function triggerInstall(): Promise<void> {
    if (canNativeInstall.value && pwa?.install) {
      await pwa.install()
      return
    }
    iosGuideOpen.value = true
  }

  function dismissBanner(): void {
    dismissed.value = true
    try {
      localStorage.setItem(DISMISS_KEY, '1')
    }
    catch { /* private mode — banner just reappears next load */ }
  }

  return { showEntry, bannerVisible, canNativeInstall, isIos, iosGuideOpen, triggerInstall, dismissBanner }
}
```

（`ssr: false`，composable 只會在 client 執行，window/navigator 可直接用。）

- [ ] **Step 2: 建 `apps/web/components/InstallPrompt.vue`**

```vue
<script setup lang="ts">
import { Share, Smartphone, SquarePlus, X } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  Dialog, DialogClose, DialogContent, DialogDescription,
  DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'

const props = defineProps<{ variant: 'banner' | 'row' }>()

const { showEntry, bannerVisible, canNativeInstall, iosGuideOpen, triggerInstall, dismissBanner } = useInstallPrompt()

const visible = computed(() => (props.variant === 'banner' ? bannerVisible.value : showEntry.value))
const buttonText = computed(() => (canNativeInstall.value ? '安裝' : '查看安裝步驟'))
</script>

<template>
  <template v-if="visible">
    <!-- Banner：總覽頂部，可關閉 -->
    <div
      v-if="variant === 'banner'"
      class="flex items-center gap-3 rounded-lg border border-border bg-muted/30 px-3 py-2.5"
    >
      <Smartphone class="h-5 w-5 shrink-0 text-muted-foreground" />
      <p class="min-w-0 flex-1 text-sm">把 Bill Alarm 安裝到主畫面，開啟更快。</p>
      <Button size="sm" @click="triggerInstall">{{ buttonText }}</Button>
      <Button size="sm" variant="ghost" class="shrink-0 px-2" aria-label="關閉" @click="dismissBanner">
        <X class="h-4 w-4" />
      </Button>
    </div>

    <!-- Row：設定頁固定入口 -->
    <Card v-else class="flex flex-wrap items-center justify-between gap-3 p-4">
      <div class="flex min-w-0 items-center gap-3">
        <Smartphone class="h-5 w-5 shrink-0 text-muted-foreground" />
        <div class="min-w-0">
          <p class="text-sm font-medium">安裝 App</p>
          <p class="text-xs text-muted-foreground">加入主畫面，以全螢幕開啟。</p>
        </div>
      </div>
      <Button size="sm" variant="outline" @click="triggerInstall">{{ buttonText }}</Button>
    </Card>
  </template>

  <!-- iOS 安裝引導（兩個 variant 共用全域狀態；Dialog 放 visible 判斷之外，
       避免 banner 被關掉後 dialog 一併消失） -->
  <Dialog v-model:open="iosGuideOpen">
    <DialogContent class="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>加入主畫面</DialogTitle>
        <DialogDescription>iPhone 需透過 Safari 手動加入主畫面：</DialogDescription>
      </DialogHeader>
      <ol class="space-y-3 text-sm">
        <li class="flex items-center gap-3">
          <span class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs">1</span>
          <span class="flex items-center gap-1.5">點底部工具列的分享按鈕 <Share class="h-4 w-4" /></span>
        </li>
        <li class="flex items-center gap-3">
          <span class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs">2</span>
          <span class="flex items-center gap-1.5">往下捲，選「加入主畫面」 <SquarePlus class="h-4 w-4" /></span>
        </li>
        <li class="flex items-center gap-3">
          <span class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs">3</span>
          <span>點右上角「加入」完成</span>
        </li>
      </ol>
      <p class="text-xs text-muted-foreground">若使用 Chrome 或 App 內建瀏覽器開啟，請先改用 Safari。</p>
      <DialogFooter>
        <DialogClose as-child><Button variant="outline">知道了</Button></DialogClose>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
```

- [ ] **Step 3: 建置＋lint＋commit**

```bash
pnpm --filter @bill-alarm/web generate
cd apps/web && npx eslint composables/useInstallPrompt.ts components/InstallPrompt.vue && cd ../..
git add apps/web/composables/useInstallPrompt.ts apps/web/components/InstallPrompt.vue
git commit -m "feat(web): install prompt composable with ios guide and native install"
```

---

### Task 3: 兩頁接線

**Files:**
- Modify: `apps/web/pages/index.vue`（Page Header 前插 banner）
- Modify: `apps/web/pages/settings/index.vue`（帳號 Card 前插 row）

- [ ] **Step 1: 總覽**

`apps/web/pages/index.vue` template 根 `<div class="space-y-6">` 的第一個子元素（`<!-- Page Header -->` 區塊之前）插入：

```vue
    <InstallPrompt variant="banner" />
```

- [ ] **Step 2: 設定頁**

`apps/web/pages/settings/index.vue` 帳號 section 內、`<Card class="flex flex-wrap items-center justify-between gap-3 p-4">`（登入身分卡）之前插入：

```vue
      <InstallPrompt variant="row" />
```

（會與登入身分卡同在帳號 section 的 `space-y-3` 下，各自成卡。）

- [ ] **Step 3: 建置＋lint＋commit**

```bash
pnpm --filter @bill-alarm/web generate
cd apps/web && npx eslint pages/index.vue pages/settings/index.vue && cd ../..
git add apps/web/pages/index.vue apps/web/pages/settings/index.vue
git commit -m "feat(web): install prompt entries on overview and settings"
```

---

### Task 4: 視覺驗證（iPhone UA 模擬）＋收尾

**Files:** 無預定修改（依驗證結果小修，限本計畫已觸及檔案）。

- [ ] **Step 1: dev 環境**

`pnpm dev:server`（:3100）＋`pnpm dev:web`（:3001）背景啟動，log 進 scratchpad；等兩者 200。dev DB 未初始化 → `/setup` 建臨時帳號 `ui-check`／`ui-check-123`（結束清除）。

- [ ] **Step 2: Playwright 驗證（viewport 390×844，UA 覆寫為 iPhone Safari）**

UA：`Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1`

檢查清單：
1. 登入後總覽：頂欄顯示「總覽」、無漢堡；底部欄 5 項、總覽高亮；安裝 banner 顯示。
2. 點 banner「查看安裝步驟」→ iOS 引導 Dialog（3 步驟）→ 關閉。
3. 關閉 banner（X）→ 重新整理 → banner 不再出現；設定頁帳號區「安裝 App」row 仍在。
4. 底部欄逐一點擊 帳單／銀行／紀錄／設定 → 路由切換、頂欄標題跟著變、active 高亮正確（在 /bills 時「總覽」不可高亮）。
5. `/login`（登出後）：無底部欄。
6. 水平溢出：`document.documentElement.scrollWidth <= window.innerWidth`。
7. 桌面 1280×860：側欄如舊、無底部欄。
8. 截圖：`shell-mobile-overview.png`（banner＋底部欄）、`shell-ios-guide.png`（Dialog 開啟）、`shell-mobile-bills.png`（帳單頁＋高亮）、`shell-desktop.png`。

- [ ] **Step 3: 清理**

臨時帳號刪除（`sqlite3 apps/server/data/bill-alarm.db "DELETE FROM settings WHERE key IN ('auth_username','auth_password_hash'); DELETE FROM sessions;"`）、dev servers 關閉、截圖移 scratchpad、`git status` 乾淨（除本計畫 commits）。

- [ ] **Step 4: 依驗證結果小修（如有）→ `pnpm --filter @bill-alarm/web generate` → commit `fix(web): mobile shell polish from visual verification`**
