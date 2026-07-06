# Account-Management Dedicated Page + Neutral Terminology Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pull user administration out of the settings-page card into a dedicated admin-only page `/settings/users`, guarded by route middleware, and replace all family-flavored terminology (家人/成員) with neutral 使用者/管理員 — frontend only, backend untouched.

**Architecture:** New named route middleware `admin` awaits the user profile then redirects non-admins before render. A new `pages/settings/users.vue` absorbs the logic of `components/settings/UsersCard.vue` (which is deleted) as a full-page list with a created-time column. The settings page's system section swaps the card for a clickable entry row. Four other files get `成員`→`使用者` copy fixes.

**Tech Stack:** Nuxt 4 SPA (`ssr: false`), shadcn-vue auto-registered components, vue-sonner, composables auto-imported.

**Spec:** `docs/superpowers/specs/2026-07-06-account-management-ui-design.md`

## Global Constraints

- Frontend only. NO server, schema, migration, or API change. Server tests stay 67/67 (do not touch them).
- admin stays a normal data-user with one extra capability (user management). No super-admin cross-tenant anything.
- Access guard MUST be route middleware that `await fetchMe()` when `me` is null, then redirects non-admins — NOT a `watch(isAdmin)` (auth.global.ts fills `authed` but not `me`; a member's `isAdmin` starts false and stays false, so a watcher may never fire and the page would render + call the users API).
- Terminology: neutral `使用者` / `管理員` everywhere; ZERO residual `家人` / `成員` in `apps/web` (`.vue`/`.ts`) after this change.
- Bottom nav unchanged (5 tabs, symmetric). `/settings/users` is reached only via the settings entry row.
- User-facing copy zh-TW; code/comments English.
- Verification gate: `pnpm --filter @bill-alarm/web generate` exits 0; `grep -rn '家人\|成員' apps/web --include='*.vue' --include='*.ts'` returns nothing.
- No web Table UI component exists — use the existing row layout (do not add a `<table>` or a new ui component).

---

### Task 1: Dedicated /settings/users page, admin middleware, entry row, terminology sweep

**Files:**
- Create: `apps/web/middleware/admin.ts`
- Create: `apps/web/pages/settings/users.vue`
- Delete: `apps/web/components/settings/UsersCard.vue`
- Modify: `apps/web/pages/settings/index.vue` (entry row at `:198`, identity role at `:160`)
- Modify: `apps/web/components/settings/IntegrationTelegram.vue` (`:55`, `:77`)
- Modify: `apps/web/components/settings/ScanConfigCard.vue` (`:49`, `:50`)

**Interfaces:**
- Consumes: `useAuth()` → `{ me, isAdmin, fetchMe }`; `useUsersApi()` → `list/create/resetPassword/deactivate/restore/removePermanently`; `UserDTO` (`{ id, username, role, telegramBound, emailConfigured, deletedAt, createdAt }`).
- Produces: route `/settings/users` (admin-only); `UsersCard` no longer exists.

- [ ] **Step 1: Create the admin route middleware**

`apps/web/middleware/admin.ts`:

```ts
export default defineNuxtRouteMiddleware(async () => {
  const { me, isAdmin, fetchMe } = useAuth()
  // auth.global.ts populates `authed` but not `me`, and app.vue only fetches
  // `me` in onMounted — so on a direct load `me` is null here. Fetch it before
  // deciding, otherwise a member would slip through (isAdmin stays false and a
  // watcher would never fire).
  if (!me.value) await fetchMe()
  if (!isAdmin.value) return navigateTo('/settings')
})
```

- [ ] **Step 2: Create the dedicated page**

`apps/web/pages/settings/users.vue` — moves `UsersCard`'s script verbatim, adds `definePageMeta({ middleware: 'admin' })`, a page header with a back link, a created-time column, and neutral copy:

```vue
<script setup lang="ts">
import { ArrowLeft, KeyRound, Plus, UserX, Users } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import type { UserDTO } from '~/composables/useUsersApi'

definePageMeta({ middleware: 'admin' })

const usersApi = useUsersApi()

const users = ref<UserDTO[]>([])
const loading = ref(true)
const submitting = ref(false)

const createOpen = ref(false)
const createForm = ref({ username: '', password: '' })
const resetTarget = ref<UserDTO | null>(null)
const resetPassword = ref('')
const deactivateTarget = ref<UserDTO | null>(null)
const purgeTarget = ref<UserDTO | null>(null)

function formatDate(date: string): string {
  const d = new Date(date)
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`
}

async function fetchUsers() {
  loading.value = true
  try {
    users.value = await usersApi.list()
  } catch (e: any) {
    toast.error('載入使用者失敗', { description: e?.data?.error ?? String(e) })
  } finally {
    loading.value = false
  }
}

async function handleCreate() {
  if (createForm.value.password.length < 8) {
    toast.error('密碼至少 8 碼')
    return
  }
  submitting.value = true
  try {
    await usersApi.create(createForm.value.username, createForm.value.password)
    toast.success('帳號已建立')
    createOpen.value = false
    createForm.value = { username: '', password: '' }
    await fetchUsers()
  } catch (e: any) {
    toast.error('建立失敗', { description: e?.data?.error ?? String(e) })
  } finally {
    submitting.value = false
  }
}

async function handleReset() {
  if (!resetTarget.value) return
  if (resetPassword.value.length < 8) {
    toast.error('密碼至少 8 碼')
    return
  }
  submitting.value = true
  try {
    await usersApi.resetPassword(resetTarget.value.id, resetPassword.value)
    toast.success(`已重設 ${resetTarget.value.username} 的密碼`, { description: '該使用者的所有裝置已被登出。' })
    resetTarget.value = null
    resetPassword.value = ''
  } catch (e: any) {
    toast.error('重設失敗', { description: e?.data?.error ?? String(e) })
  } finally {
    submitting.value = false
  }
}

async function handleDeactivate() {
  if (!deactivateTarget.value) return
  submitting.value = true
  try {
    await usersApi.deactivate(deactivateTarget.value.id)
    toast.success(`已停用 ${deactivateTarget.value.username}`, { description: '資料保留，可隨時還原。' })
    deactivateTarget.value = null
    await fetchUsers()
  } catch (e: any) {
    toast.error('停用失敗', { description: e?.data?.error ?? String(e) })
  } finally {
    submitting.value = false
  }
}

async function handleRestore(user: UserDTO) {
  submitting.value = true
  try {
    await usersApi.restore(user.id)
    toast.success(`已還原 ${user.username}`)
    await fetchUsers()
  } catch (e: any) {
    toast.error('還原失敗', { description: e?.data?.error ?? String(e) })
  } finally {
    submitting.value = false
  }
}

async function handlePurge() {
  if (!purgeTarget.value) return
  submitting.value = true
  try {
    await usersApi.removePermanently(purgeTarget.value.id)
    toast.success(`已永久刪除 ${purgeTarget.value.username}`)
    purgeTarget.value = null
    await fetchUsers()
  } catch (e: any) {
    toast.error('刪除失敗', { description: e?.data?.error ?? String(e) })
  } finally {
    submitting.value = false
  }
}

onMounted(fetchUsers)

useHead({ title: '使用者管理 - Bill Alarm' })
</script>

<template>
  <div class="space-y-6 max-w-4xl">
    <Button variant="ghost" size="sm" class="-ml-2" @click="navigateTo('/settings')">
      <ArrowLeft class="h-4 w-4" />
      返回設定
    </Button>

    <div class="flex flex-wrap items-center justify-between gap-3">
      <div class="flex items-center gap-3">
        <Users class="h-6 w-6 shrink-0 text-muted-foreground" />
        <div>
          <h1 class="text-2xl font-bold tracking-tight">使用者管理</h1>
          <p class="text-sm text-muted-foreground">建立獨立帳號，每人各自管理自己的帳單。</p>
        </div>
      </div>
      <Button @click="createOpen = true">
        <Plus class="mr-1 h-4 w-4" />
        新增使用者
      </Button>
    </div>

    <div v-if="loading" class="space-y-2">
      <div v-for="i in 3" :key="i" class="h-14 animate-pulse rounded-lg bg-muted" />
    </div>

    <div v-else class="space-y-2">
      <div
        v-for="user in users" :key="user.id"
        class="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-4 py-3"
      >
        <div class="flex min-w-0 flex-col gap-1">
          <div class="flex items-center gap-2">
            <span class="truncate text-sm font-medium">{{ user.username }}</span>
            <Badge variant="secondary" class="text-[10px]">{{ user.role === 'admin' ? '管理員' : '使用者' }}</Badge>
            <Badge v-if="user.deletedAt" variant="outline" class="text-[10px] text-muted-foreground">已停用</Badge>
          </div>
          <div class="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
            <span>{{ user.emailConfigured ? '信箱已設定' : '信箱未設定' }}</span>
            <span>{{ user.telegramBound ? 'TG 已綁定' : 'TG 未綁定' }}</span>
            <span>建立於 {{ formatDate(user.createdAt) }}</span>
          </div>
        </div>
        <div class="flex items-center gap-1">
          <template v-if="!user.deletedAt">
            <Button v-if="user.role !== 'admin'" size="icon-sm" variant="ghost" title="重設密碼" @click="resetTarget = user; resetPassword = ''">
              <KeyRound class="h-4 w-4" />
            </Button>
            <Button
              v-if="user.role !== 'admin'"
              size="icon-sm" variant="ghost" title="停用帳號"
              class="text-destructive hover:bg-destructive/10 hover:text-destructive"
              @click="deactivateTarget = user"
            >
              <UserX class="h-4 w-4" />
            </Button>
          </template>
          <template v-else>
            <Button size="sm" variant="outline" :disabled="submitting" @click="handleRestore(user)">還原</Button>
            <Button
              size="sm" variant="ghost"
              class="text-destructive hover:bg-destructive/10 hover:text-destructive"
              @click="purgeTarget = user"
            >
              永久刪除
            </Button>
          </template>
        </div>
      </div>
    </div>

    <!-- Create dialog -->
    <Dialog :open="createOpen" @update:open="createOpen = $event">
      <DialogContent class="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>新增使用者</DialogTitle>
          <DialogDescription>設好帳號密碼交給對方，登入後可自行修改。</DialogDescription>
        </DialogHeader>
        <form class="space-y-3" @submit.prevent="handleCreate">
          <div class="space-y-2">
            <Label for="newUsername">帳號</Label>
            <Input id="newUsername" v-model="createForm.username" autocomplete="off" required />
          </div>
          <div class="space-y-2">
            <Label for="newUserPw">初始密碼</Label>
            <Input id="newUserPw" v-model="createForm.password" type="password" autocomplete="new-password" required />
          </div>
          <DialogFooter class="gap-2 sm:gap-0">
            <DialogClose as-child><Button type="button" variant="outline">取消</Button></DialogClose>
            <Button type="submit" :disabled="submitting">建立</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>

    <!-- Reset password dialog -->
    <Dialog :open="!!resetTarget" @update:open="(v: boolean) => { if (!v) resetTarget = null }">
      <DialogContent class="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>重設密碼 — {{ resetTarget?.username }}</DialogTitle>
          <DialogDescription>重設後該使用者所有裝置會被登出。</DialogDescription>
        </DialogHeader>
        <form class="space-y-3" @submit.prevent="handleReset">
          <div class="space-y-2">
            <Label for="resetPw">新密碼</Label>
            <Input id="resetPw" v-model="resetPassword" type="password" autocomplete="new-password" required />
          </div>
          <DialogFooter class="gap-2 sm:gap-0">
            <DialogClose as-child><Button type="button" variant="outline">取消</Button></DialogClose>
            <Button type="submit" :disabled="submitting">重設</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>

    <!-- Deactivate confirm -->
    <Dialog :open="!!deactivateTarget" @update:open="(v: boolean) => { if (!v) deactivateTarget = null }">
      <DialogContent class="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>停用帳號</DialogTitle>
          <DialogDescription>「{{ deactivateTarget?.username }}」將無法登入，其掃描與通知會暫停；帳單與設定全數保留，可隨時還原。</DialogDescription>
        </DialogHeader>
        <DialogFooter class="gap-2 sm:gap-0">
          <DialogClose as-child><Button variant="outline">取消</Button></DialogClose>
          <Button variant="destructive" :disabled="submitting" @click="handleDeactivate">停用</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- Permanent delete confirm -->
    <Dialog :open="!!purgeTarget" @update:open="(v: boolean) => { if (!v) purgeTarget = null }">
      <DialogContent class="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>永久刪除</DialogTitle>
          <DialogDescription>確定要永久刪除「{{ purgeTarget?.username }}」嗎？其帳單、銀行、通知規則與掃描紀錄會一併刪除，此操作無法復原。</DialogDescription>
        </DialogHeader>
        <DialogFooter class="gap-2 sm:gap-0">
          <DialogClose as-child><Button variant="outline">取消</Button></DialogClose>
          <Button variant="destructive" :disabled="submitting" @click="handlePurge">確認永久刪除</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>
```

- [ ] **Step 3: Delete the old card**

```bash
rm apps/web/components/settings/UsersCard.vue
```

(Grep first to confirm `pages/settings/index.vue:198` is the only importer — Step 4 removes that reference in the same task, so the tree stays consistent.)

- [ ] **Step 4: Settings page — entry row + identity terminology**

In `apps/web/pages/settings/index.vue`:

(a) Add `Users` and `ChevronRight` to the lucide-vue-next import (whichever import line lists the icons — keep the existing ones).

(b) Replace `<SettingsUsersCard />` (line ~198) with a clickable entry row:

```vue
      <Card
        class="flex cursor-pointer items-center justify-between gap-3 p-4 transition-colors hover:border-primary/50"
        @click="navigateTo('/settings/users')"
      >
        <div class="flex min-w-0 items-center gap-3">
          <Users class="h-5 w-5 shrink-0 text-muted-foreground" />
          <div class="min-w-0">
            <p class="text-sm font-medium">使用者管理</p>
            <p class="truncate text-xs text-muted-foreground">新增、停用、重設使用者帳號</p>
          </div>
        </div>
        <ChevronRight class="h-5 w-5 shrink-0 text-muted-foreground" />
      </Card>
```

(c) Identity role at line ~160: `{{ me.role === 'admin' ? '管理者' : '成員' }}` → `{{ me.role === 'admin' ? '管理員' : '使用者' }}`.

- [ ] **Step 5: Terminology sweep in the two remaining components**

`apps/web/components/settings/IntegrationTelegram.vue`:
- `:55` `每位成員在「帳號」區各自綁定接收通知。` → `每位使用者在「帳號」區各自綁定接收通知。`
- `:77` `目前沒有任何成員綁定，通知不會發送。` → `目前沒有任何使用者綁定，通知不會發送。`

`apps/web/components/settings/ScanConfigCard.vue`:
- `:49` `全域掃描節奏，套用到所有成員的信箱。` → `全域掃描節奏，套用到所有使用者的信箱。`
- `:50` `定時檢查所有成員信箱是否有新帳單。` → `定時檢查所有使用者信箱是否有新帳單。`

- [ ] **Step 6: Verify no residual terminology**

Run: `grep -rn '家人\|成員' apps/web --include='*.vue' --include='*.ts'`
Expected: no output (zero matches).

- [ ] **Step 7: Verify the build**

Run: `pnpm --filter @bill-alarm/web generate`
Expected: exit 0, `/settings/users` among the prerendered routes.

- [ ] **Step 8: Confirm server untouched**

Run: `pnpm --filter @bill-alarm/server test`
Expected: 67/67 (no server files changed).

- [ ] **Step 9: Commit**

```bash
git add apps/web/middleware/admin.ts apps/web/pages/settings/users.vue apps/web/pages/settings/index.vue apps/web/components/settings/IntegrationTelegram.vue apps/web/components/settings/ScanConfigCard.vue
git add -A apps/web/components/settings/UsersCard.vue
git commit -m "feat(web): dedicated /settings/users admin page, neutral user terminology"
```
