# 設定頁重構（狀態卡片＋折疊＋RWD）實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 設定頁改為「狀態卡片＋折疊」模式（Immich/GitHub integrations 風格），行動優先修正 RWD，收編孤兒登出鈕為帳號區塊。

**Architecture:** 新增共用 `SettingsCard`（Card + Collapsible + 狀態 Badge）包裹四個既有 Integration 元件；各元件卸下自己的標題列與裸紅字錯誤（狀態上移到卡片標題列、錯誤改 `Alert`）；`pages/settings/index.vue` 拿掉 tabs 改單頁三區（服務整合／通知規則／帳號）。API、composables、各元件的表單邏輯完全不動。

**Tech Stack:** Nuxt 4 SPA + shadcn-vue（新增 `collapsible`、`alert` 兩個 ui 元件）+ UnoCSS。無 web 測試框架 — 驗證方式為 `generate` 建置 + ESLint + Playwright 截圖比對（390px/1280px）。

**Spec:** `docs/superpowers/specs/2026-07-05-settings-redesign-design.md`

## Global Constraints

- UI 文案繁體中文（台灣）；程式碼與 commit 英文、conventional commits。
- `components/ui/` 由 CLI 生成，除 CLI add 外不得手改；若 CLI 失敗才允許依既有 ui 元件風格 vendor。
- **不可修改**：`apps/server/**`（本次純前端）、`apps/server/src/parsers/hsbc.ts`。注意：`apps/web/components/settings/NotificationRuleDialog.vue`、`NotificationRuleList.vue`、`apps/web/pages/banks/index.vue` 這三個檔案先前的未提交變更已在 commit `40cceba` 落地，工作區現在是乾淨的 — 本計畫 Task 中除明確列出者外仍不要動它們。
- 每個 Task 完成前必須通過：`pnpm --filter @bill-alarm/web generate`（建置成功）。
- ESLint stylistic：無分號、單引號。頁面/元件內 `components/ui` 需明確 import（無 auto-import）；`components/settings/` 下的元件在頁面中以 `Settings` 前綴 auto-import（如 `<SettingsIntegrationEmail>`，Nuxt 目錄慣例）。
- lucide 圖示從 `lucide-vue-next` import。
- 所有指令於 repo root 執行：`/Users/ysya/project/homelab/bill-alarm`。

---

### Task 1: 新增 ui 元件（collapsible、alert）+ SettingsCard

**Files:**
- CLI 生成: `apps/web/components/ui/collapsible/`、`apps/web/components/ui/alert/`
- Create: `apps/web/components/settings/SettingsCard.vue`
- Modify: `apps/web/package.json` / `pnpm-lock.yaml`（CLI 可能加 deps，例如 reka-ui 已在依賴中則不變）

**Interfaces:**
- Produces: `SettingsCard`（props: `icon: Component`、`title: string`、`status: 'ok' | 'unset' | 'error'`、`statusText?: string`、`defaultOpen?: boolean`；default slot = 卡片內容）。
- 檔案位置刻意放在 `apps/web/components/SettingsCard.vue`（components 根目錄）：Nuxt 目錄前綴 auto-import 規則下，放 `components/settings/` 會得到 `SettingsSettingsCard` 這種名稱；放根目錄則以 `<SettingsCard>` 使用。

- [ ] **Step 1: CLI 加元件**

```bash
pnpm dlx shadcn-vue@latest add collapsible alert
```

Expected: `apps/web/components/ui/collapsible/{Collapsible,CollapsibleContent,CollapsibleTrigger,index}.vue|ts`、`apps/web/components/ui/alert/{Alert,AlertDescription,AlertTitle,index}.ts|vue` 生成。若 CLI 詢問覆寫，選不覆寫既有檔。確認各目錄 `index.ts` 的實際 export 名稱（後續 import 以它為準）。

- [ ] **Step 2: 建 `apps/web/components/SettingsCard.vue`**

```vue
<script setup lang="ts">
import type { Component } from 'vue'
import { ChevronDown } from 'lucide-vue-next'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'

const props = withDefaults(defineProps<{
  icon: Component
  title: string
  status: 'ok' | 'unset' | 'error'
  statusText?: string
  defaultOpen?: boolean
}>(), { statusText: undefined, defaultOpen: false })

const open = ref(props.defaultOpen)

const STATUS_TEXT: Record<'ok' | 'unset' | 'error', string> = {
  ok: '已設定',
  unset: '未設定',
  error: '錯誤',
}
const STATUS_CLASS: Record<'ok' | 'unset' | 'error', string> = {
  ok: 'border-green-500/40 bg-green-500/10 text-green-500',
  unset: 'border-border bg-muted text-muted-foreground',
  error: 'border-destructive/40 bg-destructive/10 text-destructive',
}

const badgeText = computed(() => props.statusText ?? STATUS_TEXT[props.status])
</script>

<template>
  <Card class="overflow-hidden py-0 gap-0">
    <Collapsible v-model:open="open">
      <CollapsibleTrigger
        class="flex w-full min-h-11 items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/50"
      >
        <component :is="icon" class="h-5 w-5 shrink-0 text-muted-foreground" />
        <span class="min-w-0 flex-1 truncate text-sm font-semibold">{{ title }}</span>
        <Badge variant="outline" class="shrink-0" :class="STATUS_CLASS[status]">{{ badgeText }}</Badge>
        <ChevronDown class="h-4 w-4 shrink-0 text-muted-foreground transition-transform" :class="{ 'rotate-180': open }" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div class="border-t border-border px-4 py-4">
          <slot />
        </div>
      </CollapsibleContent>
    </Collapsible>
  </Card>
</template>
```

注意：既有 `Card` 元件若自帶 padding/gap（查看 `components/ui/card/Card.vue` 的 class），用外覆 class 蓋掉使標題列貼齊卡片邊緣；以實際生成的 Card 樣式為準微調（此為本 Task 唯一允許的判斷空間，結果需與 ASCII 佈局一致：標題列滿寬、內容區有 border-t）。

- [ ] **Step 3: 建置驗證**

```bash
pnpm --filter @bill-alarm/web generate
```

Expected: 成功（SettingsCard 尚未被引用也應可建置）。

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/ui/collapsible apps/web/components/ui/alert apps/web/components/SettingsCard.vue apps/web/package.json pnpm-lock.yaml
git commit -m "feat(web): add collapsible/alert ui components and SettingsCard shell"
```

（若 CLI 未動 package.json/lock，git add 略過該兩檔。）

---

### Task 2: IntegrationEmail 卸標題＋Alert 錯誤＋動作列統一；ConfigRow RWD

**Files:**
- Modify: `apps/web/components/settings/IntegrationEmail.vue`
- Modify: `apps/web/components/settings/ConfigRow.vue`

**Interfaces:**
- Consumes: 無（狀態 Badge 由 Task 5 的 index.vue 計算，本元件不需新 props）。
- Produces: 元件不再渲染自己的標題列與狀態；根元素為卡片「內容」。script 區邏輯零變更。

- [ ] **Step 1: ConfigRow RWD**

`apps/web/components/settings/ConfigRow.vue` 的 template 換為：

```vue
<template>
  <div class="flex flex-col gap-2 rounded-lg border border-border p-3 sm:flex-row sm:items-center sm:justify-between">
    <div class="min-w-0 space-y-0.5 sm:flex-1">
      <div class="flex items-center gap-2">
        <slot name="icon" />
        <span class="text-sm font-medium">{{ label }}</span>
      </div>
      <p v-if="description" class="text-xs text-muted-foreground">{{ description }}</p>
    </div>
    <div class="shrink-0 sm:ml-4">
      <slot />
    </div>
  </div>
  <slot name="below" />
</template>
```

（script 不變。效果：<640px 上下堆疊、控制項在下方；≥sm 恢復左右。）

- [ ] **Step 2: IntegrationEmail template 改造**

對 `IntegrationEmail.vue` 做四個修改（script 區僅刪除不再使用的 icon import — 改完後跑 lint 依報錯移除，預期 `Mail` 仍用於掃描按鈕、`XCircle/CheckCircle` 仍用於 Alert/測試結果，實際以 lint 為準）：

(a) 刪除 Header 區塊（原 159–170 行）：

```vue
    <!-- Header -->
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-2">
        <Mail class="h-5 w-5" />
        <h3 class="text-sm font-semibold">信箱（Gmail IMAP）</h3>
        <span class="inline-flex items-center gap-1 text-xs text-muted-foreground">
          <span class="inline-block h-2 w-2 rounded-full shrink-0"
            :class="email.isConnected ? 'bg-green-500' : email.hasCredentials ? 'bg-yellow-500' : 'bg-red-500'" />
          {{ email.isConnected ? '已連線' : email.hasCredentials ? '已設定，連線失敗' : '未設定' }}
        </span>
      </div>
    </div>
```

整段移除。

(b) State 2 開頭的狀態行＋裸紅字（原 226–232 行）：

```vue
      <div class="flex items-center gap-2 text-sm">
        <CheckCircle v-if="email.isConnected" class="h-4 w-4 text-green-500" />
        <XCircle v-else class="h-4 w-4 text-red-500" />
        <span>{{ email.isConnected ? '信箱已連線' : '信箱連線失敗' }}</span>
        <span v-if="email.user" class="text-muted-foreground">({{ email.user }})</span>
      </div>
      <p v-if="!email.isConnected" class="text-xs text-red-500">{{ email.message }}</p>
```

換為：

```vue
      <Alert v-if="!email.isConnected" variant="destructive">
        <XCircle class="h-4 w-4" />
        <AlertTitle>信箱連線失敗</AlertTitle>
        <AlertDescription>{{ email.message }}</AlertDescription>
      </Alert>
      <div v-else class="flex items-center gap-2 text-sm">
        <CheckCircle class="h-4 w-4 text-green-500" />
        <span>信箱已連線</span>
        <span v-if="email.user" class="text-muted-foreground">({{ email.user }})</span>
      </div>
```

script 區加 import（依 Task 1 生成的 index export 名稱）：

```ts
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
```

(c) State 1 表單的按鈕列（原 210–220 行）統一為「次要靠左、主要靠右」：

```vue
        <div class="flex flex-wrap items-center justify-between gap-2">
          <Button type="button" size="sm" variant="outline" :disabled="testing" @click="handleTestConnection">
            {{ testing ? '測試中...' : '測試連線' }}
          </Button>
          <div class="flex gap-2">
            <Button v-if="email.hasCredentials" type="button" size="sm" variant="ghost" @click="showCredentials = false">
              取消
            </Button>
            <Button type="submit" size="sm" :disabled="submitting">
              {{ submitting ? '儲存中...' : '儲存' }}
            </Button>
          </div>
        </div>
```

(d) State 2 的動作按鈕列（原 286–302 行）外層 class 加 wrap：`<div class="flex gap-2">` → `<div class="flex flex-wrap gap-2">`（內容不變）。

- [ ] **Step 3: 建置＋lint**

```bash
pnpm --filter @bill-alarm/web generate
cd apps/web && npx eslint components/settings/IntegrationEmail.vue components/settings/ConfigRow.vue && cd ../..
```

Expected: 建置成功；eslint 無錯誤（unused import 依報錯清理）。

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/settings/IntegrationEmail.vue apps/web/components/settings/ConfigRow.vue
git commit -m "refactor(web): strip email section header, alert-based errors, responsive config rows"
```

---

### Task 3: IntegrationCalendar + IntegrationTelegram 卸標題與 RWD

**Files:**
- Modify: `apps/web/components/settings/IntegrationCalendar.vue`
- Modify: `apps/web/components/settings/IntegrationTelegram.vue`

**Interfaces:** 同 Task 2 — 元件根元素成為卡片內容；script 邏輯零變更。

- [ ] **Step 1: Calendar**

(a) Header（原 49–58 行）刪除，「如何訂閱？」按鈕移進內容首行與描述並排：

原 49–63 行整段：

```vue
    <div class="flex items-center justify-between gap-2">
      <div class="flex items-center gap-2">
        <CalendarCheck class="h-5 w-5" />
        <h3 class="text-sm font-semibold">行事曆訂閱（ICS Feed）</h3>
      </div>
      <Button type="button" size="sm" variant="ghost" @click="helpDialogOpen = true">
        <HelpCircle class="mr-1 h-4 w-4" />
        如何訂閱？
      </Button>
    </div>

    <p class="text-xs text-muted-foreground">
      把帳單到期日當作日曆事件單向訂閱，不需 OAuth、不需授權。複製下方網址貼到任何支援
      iCalendar 的應用程式（Google Calendar、Apple 行事曆、Outlook 等）。
    </p>
```

換為：

```vue
    <div class="flex items-start justify-between gap-2">
      <p class="text-xs text-muted-foreground">
        把帳單到期日當作日曆事件單向訂閱，不需 OAuth、不需授權。複製下方網址貼到任何支援
        iCalendar 的應用程式（Google Calendar、Apple 行事曆、Outlook 等）。
      </p>
      <Button type="button" size="sm" variant="ghost" class="shrink-0" @click="helpDialogOpen = true">
        <HelpCircle class="mr-1 h-4 w-4" />
        如何訂閱？
      </Button>
    </div>
```

（`CalendarCheck` import 移除 — 若 index.vue Task 5 需要它，各自 import，互不影響。）

(b) 訂閱網址列 RWD（原 67 行）：`<div class="flex gap-2">` → `<div class="flex flex-col gap-2 sm:flex-row">`，並給複製鈕 `class="sm:shrink-0"`。

- [ ] **Step 2: Telegram**

Header（原 52–62 行）整段刪除：

```vue
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-2">
        <Send class="h-5 w-5" />
        <h3 class="text-sm font-semibold">Telegram</h3>
        <span class="inline-flex items-center gap-1 text-xs text-muted-foreground">
          <span class="inline-block h-2 w-2 rounded-full shrink-0"
            :class="status.isConfigured ? 'bg-green-500' : 'bg-red-500'" />
          {{ status.isConfigured ? '已設定' : '未設定' }}
        </span>
      </div>
    </div>
```

（`Send` icon 在「發送測試」按鈕仍在用，import 保留。）其餘不動 — 其按鈕排列已符合統一樣式（primary 儲存、outline 測試）。未設定狀態的儲存鈕改靠右：`<Button type="submit" ...>` 外包 `<div class="flex justify-end">`。

- [ ] **Step 3: 建置＋lint＋commit**

```bash
pnpm --filter @bill-alarm/web generate
cd apps/web && npx eslint components/settings/IntegrationCalendar.vue components/settings/IntegrationTelegram.vue && cd ../..
git add apps/web/components/settings/IntegrationCalendar.vue apps/web/components/settings/IntegrationTelegram.vue
git commit -m "refactor(web): strip calendar/telegram section headers, responsive url row"
```

---

### Task 4: IntegrationLLM 卸標題＋動作列統一

**Files:**
- Modify: `apps/web/components/settings/IntegrationLLM.vue`
- Modify: `apps/web/types/settings.ts`（`PROVIDER_LABELS` 移出供共用）

**Interfaces:**
- Produces: `types/settings.ts` 新增 `export const LLM_PROVIDER_LABELS: Record<'none' | 'gemini' | 'openai' | 'ollama', string>`（值同元件內現有 `PROVIDER_LABELS`）。Task 5 的 index.vue 會 import 它做卡片 statusText。

- [ ] **Step 1: types/settings.ts 加共用常數**

```ts
export const LLM_PROVIDER_LABELS: Record<'none' | 'gemini' | 'openai' | 'ollama', string> = {
  none: '未啟用',
  gemini: 'Gemini (雲端)',
  openai: 'OpenAI (雲端)',
  ollama: 'Ollama (本地)',
}
```

`IntegrationLLM.vue` 刪除本地 `PROVIDER_LABELS`（原 50–55 行），改 `import { LLM_PROVIDER_LABELS } from '~/types/settings'` — 注意原本模板 header 用到它，而 header 將被刪除；若刪除 header 後無其他使用處，則元件內不需 import（以 lint 為準）。

- [ ] **Step 2: 刪 Header（原 106–118 行）**

```vue
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-2">
        <Sparkles class="h-5 w-5" />
        <h3 class="text-sm font-semibold">AI 解析器</h3>
        <span class="inline-flex items-center gap-1 text-xs text-muted-foreground">
          <span
            class="inline-block h-2 w-2 rounded-full shrink-0"
            :class="llm.provider === 'none' ? 'bg-muted-foreground' : 'bg-green-500'"
          />
          {{ PROVIDER_LABELS[llm.provider] }}
        </span>
      </div>
    </div>
```

整段移除（描述 `<p>` 保留為首行）。

- [ ] **Step 3: 動作列統一（原 242–256 行）**

```vue
    <div class="flex flex-wrap items-center justify-between gap-2">
      <Button
        v-if="form.provider !== 'none'"
        size="sm"
        variant="outline"
        :disabled="testing"
        @click="handleTest"
      >
        <Loader2 v-if="testing" class="h-3.5 w-3.5 animate-spin" />
        測試連線
      </Button>
      <span v-else />
      <Button size="sm" :disabled="saving" @click="handleSave">
        {{ saving ? '儲存中...' : '儲存' }}
      </Button>
    </div>
```

- [ ] **Step 4: 建置＋lint＋commit**

```bash
pnpm --filter @bill-alarm/web generate
cd apps/web && npx eslint components/settings/IntegrationLLM.vue types/settings.ts && cd ../..
git add apps/web/components/settings/IntegrationLLM.vue apps/web/types/settings.ts
git commit -m "refactor(web): strip llm section header, shared provider labels, unified actions"
```

---

### Task 5: settings/index.vue 重寫 — 單頁三區＋狀態計算＋帳號卡

**Files:**
- Modify: `apps/web/pages/settings/index.vue`（整檔重寫 template＋script 局部）

**Interfaces:**
- Consumes: `SettingsCard`（Task 1）、四個 Integration 元件（Task 2–4 後的形態）、`LLM_PROVIDER_LABELS`（Task 4）、`GET /api/auth/me` → `{ username }`、`useAuth().logout`。

- [ ] **Step 1: 重寫**

script 區：保留現有 rules/configStatus/dialog 邏輯不動；刪除 `const activeTab = ref('integrations')`；加入：

```ts
import { Bell, CalendarCheck, LogOut, Mail, Send, Sparkles, User } from 'lucide-vue-next'
import { Alert, AlertDescription } from '@/components/ui/alert'  // 若本頁未用可省
import { Card } from '@/components/ui/card'
import { LLM_PROVIDER_LABELS } from '~/types/settings'

const me = ref<{ username: string } | null>(null)
onMounted(async () => {
  me.value = await $fetch<{ username: string }>('/api/auth/me').catch(() => null)
})

type CardStatus = 'ok' | 'unset' | 'error'

const emailStatus = computed<{ status: CardStatus, text: string }>(() => {
  const e = configStatus.value?.email
  if (!e?.hasCredentials) return { status: 'unset', text: '未設定' }
  return e.isConnected ? { status: 'ok', text: '已連線' } : { status: 'error', text: '連線失敗' }
})

const telegramStatus = computed<{ status: CardStatus, text: string }>(() =>
  configStatus.value?.telegram.isConfigured
    ? { status: 'ok', text: '已設定' }
    : { status: 'unset', text: '未設定' },
)

const llmStatus = computed<{ status: CardStatus, text: string }>(() => {
  const s = configStatus.value
  if (!s || s.llm.provider === 'none') return { status: 'unset', text: '未啟用' }
  if (s.llm.provider === 'gemini' && !s.gemini.isConfigured) return { status: 'error', text: '缺 API Key' }
  if (s.llm.provider === 'openai' && !s.openai.isConfigured) return { status: 'error', text: '缺 API Key' }
  return { status: 'ok', text: LLM_PROVIDER_LABELS[s.llm.provider] }
})
```

template 整體結構（Dialogs 區與現有兩個 Dialog 保持原樣，附在最後）：

```vue
<template>
  <div class="space-y-8">
    <!-- Page Header -->
    <div>
      <h1 class="text-2xl font-bold tracking-tight">設定</h1>
      <p class="text-sm text-muted-foreground mt-1">管理服務整合、通知規則與帳號。</p>
    </div>

    <!-- 服務整合 -->
    <section class="space-y-3">
      <h2 class="text-sm font-medium text-muted-foreground">服務整合</h2>

      <div v-if="loading" class="space-y-3">
        <div v-for="i in 4" :key="i" class="h-12 animate-pulse rounded-xl bg-muted" />
      </div>

      <template v-else-if="configStatus">
        <SettingsCard :icon="Mail" title="信箱（Gmail IMAP）" :status="emailStatus.status" :status-text="emailStatus.text">
          <SettingsIntegrationEmail :email="configStatus.email" :scan="configStatus.scan" @refresh="fetchData" />
        </SettingsCard>

        <SettingsCard :icon="CalendarCheck" title="行事曆訂閱（ICS Feed）" status="ok" status-text="已啟用">
          <SettingsIntegrationCalendar :calendar="configStatus.calendar" @refresh="fetchData" />
        </SettingsCard>

        <SettingsCard :icon="Send" title="Telegram" :status="telegramStatus.status" :status-text="telegramStatus.text">
          <SettingsIntegrationTelegram :status="configStatus.telegram" @refresh="fetchData" />
        </SettingsCard>

        <SettingsCard :icon="Sparkles" title="AI 解析器" :status="llmStatus.status" :status-text="llmStatus.text">
          <SettingsIntegrationLLM
            :llm="configStatus.llm" :gemini="configStatus.gemini" :openai="configStatus.openai"
            @refresh="fetchData"
          />
        </SettingsCard>
      </template>
    </section>

    <!-- 通知規則 -->
    <section class="space-y-3">
      <h2 class="flex items-center gap-2 text-sm font-medium text-muted-foreground">
        <Bell class="h-4 w-4" />通知規則
      </h2>
      <SettingsNotificationRuleList
        :rules="rules" :loading="loading"
        @create="openCreateDialog" @edit="openEditDialog" @delete="openDeleteDialog" @refresh="fetchData"
      />
    </section>

    <!-- 帳號 -->
    <section class="space-y-3">
      <h2 class="flex items-center gap-2 text-sm font-medium text-muted-foreground">
        <User class="h-4 w-4" />帳號
      </h2>
      <Card class="flex flex-wrap items-center justify-between gap-3 p-4">
        <div class="flex min-w-0 items-center gap-3">
          <User class="h-5 w-5 shrink-0 text-muted-foreground" />
          <div class="min-w-0">
            <p class="text-sm font-medium">登入身分</p>
            <p class="truncate text-xs text-muted-foreground">{{ me?.username ?? '—' }}</p>
          </div>
        </div>
        <Button
          variant="outline" size="sm"
          class="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
          @click="logout"
        >
          <LogOut class="mr-2 h-4 w-4" />
          登出
        </Button>
      </Card>
    </section>

    <!-- Dialogs（原內容不動）-->
    …（SettingsNotificationRuleDialog 與刪除確認 Dialog 原樣保留）…
  </div>
</template>
```

移除：`Tabs/TabsList/TabsTrigger/TabsContent` 全部、頁尾 `<Button variant="destructive" class="mt-6" @click="logout">登出</Button>`、四張卡之間的 `<Separator />`。`Button` 的 import 檢查本頁是否已有（原本無 — 加 `import { Button } from '@/components/ui/button'`）。

- [ ] **Step 2: 建置＋lint＋commit**

```bash
pnpm --filter @bill-alarm/web generate
cd apps/web && npx eslint pages/settings/index.vue && cd ../..
git add apps/web/pages/settings/index.vue
git commit -m "feat(web): settings page as status cards with account section, drop tabs"
```

---

### Task 6: 視覺驗證（390px／1280px 截圖）＋收尾修正

**Files:**
- 無預定修改（依驗證結果做小修，僅限本計畫已觸及的檔案）

- [ ] **Step 1: 啟動 dev 環境**

```bash
pnpm dev:server &   # :3100
pnpm dev:web &      # :3001
```

等待 `curl -s http://localhost:3100/api/health` 與 `http://localhost:3001` 皆 200。

- [ ] **Step 2: Playwright 驗證流程**

1. 開 `http://localhost:3001/settings` → 會被導到 `/setup`（dev DB 未初始化）→ 建立臨時帳號（`ui-check` / `ui-check-123`，結束後清除）。
2. 進 `/settings`，驗證：
   - 初載所有卡片收合；四張卡標題列各有正確 Badge（dev DB 狀態下预期：信箱=連線失敗(紅) 或未設定、行事曆=已啟用、Telegram=未設定、AI=依 dev 設定）。
   - 展開信箱卡：錯誤以 Alert 呈現（若 dev 有假憑證）；動作列「測試連線」左、「儲存」右。
   - 通知規則清單、新增/編輯 Dialog 正常開闔。
   - 帳號卡顯示 `ui-check`；按登出 → 回 `/login`（再登入繼續驗證其餘）。
3. viewport 390×844 全頁截圖 `settings-after-mobile.png`；1280×860 截圖 `settings-after-desktop.png`。
4. **水平溢出檢查**（390px）：`document.documentElement.scrollWidth <= window.innerWidth` 為 true。

- [ ] **Step 3: 清理**

```bash
sqlite3 apps/server/data/bill-alarm.db "DELETE FROM settings WHERE key IN ('auth_username','auth_password_hash'); DELETE FROM sessions;"
# kill dev servers；截圖移到 scratchpad（不留在 repo）
```

- [ ] **Step 4: 依驗證結果小修（如有）→ 重跑建置 → commit**

```bash
pnpm --filter @bill-alarm/web generate
git add <touched files>
git commit -m "fix(web): settings polish from visual verification"
```

（無修正則略過此 commit。）
