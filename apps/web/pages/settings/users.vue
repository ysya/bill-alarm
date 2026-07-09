<script setup lang="ts">
import { ArrowLeft, KeyRound, Plus, UserX, Users } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { apiErrorMessage } from '@/lib/utils'
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
  }
  catch (e) {
    toast.error('載入使用者失敗', { description: apiErrorMessage(e) })
  }
  finally {
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
  }
  catch (e) {
    toast.error('建立失敗', { description: apiErrorMessage(e) })
  }
  finally {
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
  }
  catch (e) {
    toast.error('重設失敗', { description: apiErrorMessage(e) })
  }
  finally {
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
  }
  catch (e) {
    toast.error('停用失敗', { description: apiErrorMessage(e) })
  }
  finally {
    submitting.value = false
  }
}

async function handleRestore(user: UserDTO) {
  submitting.value = true
  try {
    await usersApi.restore(user.id)
    toast.success(`已還原 ${user.username}`)
    await fetchUsers()
  }
  catch (e) {
    toast.error('還原失敗', { description: apiErrorMessage(e) })
  }
  finally {
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
  }
  catch (e) {
    toast.error('刪除失敗', { description: apiErrorMessage(e) })
  }
  finally {
    submitting.value = false
  }
}

onMounted(fetchUsers)

useHead({ title: '使用者管理 - Bill Alarm' })
</script>

<template>
  <div class="space-y-6 max-w-4xl">
    <Button
      variant="ghost"
      size="sm"
      class="-ml-2"
      @click="navigateTo('/settings')"
    >
      <ArrowLeft class="h-4 w-4" />
      返回設定
    </Button>

    <div class="flex flex-wrap items-center justify-between gap-3">
      <div class="flex items-center gap-3">
        <Users class="h-6 w-6 shrink-0 text-muted-foreground" />
        <div>
          <h1 class="text-2xl font-bold tracking-tight">
            使用者管理
          </h1>
          <p class="text-sm text-muted-foreground">
            建立獨立帳號，每人各自管理自己的帳單。
          </p>
        </div>
      </div>
      <Button @click="createOpen = true">
        <Plus class="mr-1 h-4 w-4" />
        新增使用者
      </Button>
    </div>

    <div
      v-if="loading"
      class="space-y-2"
    >
      <div
        v-for="i in 3"
        :key="i"
        class="h-14 animate-pulse rounded-lg bg-muted"
      />
    </div>

    <div
      v-else
      class="space-y-2"
    >
      <div
        v-for="user in users"
        :key="user.id"
        class="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-4 py-3"
      >
        <div class="flex min-w-0 flex-col gap-1">
          <div class="flex items-center gap-2">
            <span class="truncate text-sm font-medium">{{ user.username }}</span>
            <Badge
              variant="secondary"
              class="text-[10px]"
            >
              {{ user.role === 'admin' ? '管理員' : '使用者' }}
            </Badge>
            <Badge
              v-if="user.deletedAt"
              variant="outline"
              class="text-[10px] text-muted-foreground"
            >
              已停用
            </Badge>
          </div>
          <div class="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
            <span>{{ user.emailConfigured ? '信箱已設定' : '信箱未設定' }}</span>
            <span>{{ user.telegramBound ? 'TG 已綁定' : 'TG 未綁定' }}</span>
            <span>建立於 {{ formatDate(user.createdAt) }}</span>
          </div>
        </div>
        <div class="flex items-center gap-1">
          <template v-if="!user.deletedAt">
            <Button
              v-if="user.role !== 'admin'"
              size="icon-sm"
              variant="ghost"
              title="重設密碼"
              @click="resetTarget = user; resetPassword = ''"
            >
              <KeyRound class="h-4 w-4" />
            </Button>
            <Button
              v-if="user.role !== 'admin'"
              size="icon-sm"
              variant="ghost"
              title="停用帳號"
              class="text-destructive hover:bg-destructive/10 hover:text-destructive"
              @click="deactivateTarget = user"
            >
              <UserX class="h-4 w-4" />
            </Button>
          </template>
          <template v-else>
            <Button
              size="sm"
              variant="outline"
              :disabled="submitting"
              @click="handleRestore(user)"
            >
              還原
            </Button>
            <Button
              size="sm"
              variant="ghost"
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
    <Dialog
      :open="createOpen"
      @update:open="createOpen = $event"
    >
      <DialogContent class="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>新增使用者</DialogTitle>
          <DialogDescription>設好帳號密碼交給對方，登入後可自行修改。</DialogDescription>
        </DialogHeader>
        <form
          class="space-y-3"
          @submit.prevent="handleCreate"
        >
          <div class="space-y-2">
            <Label for="newUsername">帳號</Label>
            <Input
              id="newUsername"
              v-model="createForm.username"
              autocomplete="off"
              required
            />
          </div>
          <div class="space-y-2">
            <Label for="newUserPw">初始密碼</Label>
            <Input
              id="newUserPw"
              v-model="createForm.password"
              type="password"
              autocomplete="new-password"
              required
            />
          </div>
          <DialogFooter class="gap-2 sm:gap-0">
            <DialogClose as-child>
              <Button
                type="button"
                variant="outline"
              >
                取消
              </Button>
            </DialogClose>
            <Button
              type="submit"
              :disabled="submitting"
            >
              建立
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>

    <!-- Reset password dialog -->
    <Dialog
      :open="!!resetTarget"
      @update:open="(v: boolean) => { if (!v) resetTarget = null }"
    >
      <DialogContent class="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>重設密碼 — {{ resetTarget?.username }}</DialogTitle>
          <DialogDescription>重設後該使用者所有裝置會被登出。</DialogDescription>
        </DialogHeader>
        <form
          class="space-y-3"
          @submit.prevent="handleReset"
        >
          <div class="space-y-2">
            <Label for="resetPw">新密碼</Label>
            <Input
              id="resetPw"
              v-model="resetPassword"
              type="password"
              autocomplete="new-password"
              required
            />
          </div>
          <DialogFooter class="gap-2 sm:gap-0">
            <DialogClose as-child>
              <Button
                type="button"
                variant="outline"
              >
                取消
              </Button>
            </DialogClose>
            <Button
              type="submit"
              :disabled="submitting"
            >
              重設
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>

    <!-- Deactivate confirm -->
    <Dialog
      :open="!!deactivateTarget"
      @update:open="(v: boolean) => { if (!v) deactivateTarget = null }"
    >
      <DialogContent class="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>停用帳號</DialogTitle>
          <DialogDescription>「{{ deactivateTarget?.username }}」將無法登入，其掃描與通知會暫停；帳單與設定全數保留，可隨時還原。</DialogDescription>
        </DialogHeader>
        <DialogFooter class="gap-2 sm:gap-0">
          <DialogClose as-child>
            <Button variant="outline">
              取消
            </Button>
          </DialogClose>
          <Button
            variant="destructive"
            :disabled="submitting"
            @click="handleDeactivate"
          >
            停用
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- Permanent delete confirm -->
    <Dialog
      :open="!!purgeTarget"
      @update:open="(v: boolean) => { if (!v) purgeTarget = null }"
    >
      <DialogContent class="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>永久刪除</DialogTitle>
          <DialogDescription>確定要永久刪除「{{ purgeTarget?.username }}」嗎？其帳單、銀行、通知規則與掃描紀錄會一併刪除，此操作無法復原。</DialogDescription>
        </DialogHeader>
        <DialogFooter class="gap-2 sm:gap-0">
          <DialogClose as-child>
            <Button variant="outline">
              取消
            </Button>
          </DialogClose>
          <Button
            variant="destructive"
            :disabled="submitting"
            @click="handlePurge"
          >
            確認永久刪除
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>
