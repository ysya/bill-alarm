<script setup lang="ts">
import { KeyRound, Plus, Trash2, Users } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import type { UserDTO } from '~/composables/useUsersApi'

const usersApi = useUsersApi()

const users = ref<UserDTO[]>([])
const loading = ref(true)
const submitting = ref(false)

const createOpen = ref(false)
const createForm = ref({ username: '', password: '' })
const resetTarget = ref<UserDTO | null>(null)
const resetPassword = ref('')
const deleteTarget = ref<UserDTO | null>(null)

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
    toast.success(`已重設 ${resetTarget.value.username} 的密碼`, { description: '該成員的所有裝置已被登出。' })
    resetTarget.value = null
    resetPassword.value = ''
  } catch (e: any) {
    toast.error('重設失敗', { description: e?.data?.error ?? String(e) })
  } finally {
    submitting.value = false
  }
}

async function handleDelete() {
  if (!deleteTarget.value) return
  submitting.value = true
  try {
    await usersApi.remove(deleteTarget.value.id)
    toast.success(`已刪除 ${deleteTarget.value.username}`)
    deleteTarget.value = null
    await fetchUsers()
  } catch (e: any) {
    toast.error('刪除失敗', { description: e?.data?.error ?? String(e) })
  } finally {
    submitting.value = false
  }
}

onMounted(fetchUsers)
</script>

<template>
  <Card class="space-y-3 p-4">
    <div class="flex items-center justify-between gap-3">
      <div class="flex items-center gap-3">
        <Users class="h-5 w-5 shrink-0 text-muted-foreground" />
        <div>
          <p class="text-sm font-medium">使用者管理</p>
          <p class="text-xs text-muted-foreground">為家人建立帳號，成員只能進行日常操作。</p>
        </div>
      </div>
      <Button size="sm" @click="createOpen = true">
        <Plus class="mr-1 h-4 w-4" />
        新增
      </Button>
    </div>

    <div v-if="loading" class="space-y-2">
      <div v-for="i in 2" :key="i" class="h-10 animate-pulse rounded-lg bg-muted" />
    </div>

    <div v-else class="space-y-2">
      <div
        v-for="user in users" :key="user.id"
        class="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-3 py-2"
      >
        <div class="flex min-w-0 items-center gap-2">
          <span class="truncate text-sm font-medium">{{ user.username }}</span>
          <Badge variant="secondary" class="text-[10px]">{{ user.role === 'admin' ? '管理者' : '成員' }}</Badge>
          <span class="text-xs text-muted-foreground">{{ user.telegramBound ? 'TG 已綁定' : 'TG 未綁定' }}</span>
        </div>
        <div class="flex items-center gap-1">
          <Button
            v-if="user.role !== 'admin'"
            size="icon-sm" variant="ghost" title="重設密碼"
            @click="resetTarget = user; resetPassword = ''"
          >
            <KeyRound class="h-4 w-4" />
          </Button>
          <Button
            v-if="user.role !== 'admin'"
            size="icon-sm" variant="ghost" title="刪除帳號"
            class="text-destructive hover:bg-destructive/10 hover:text-destructive"
            @click="deleteTarget = user"
          >
            <Trash2 class="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>

    <!-- Create dialog -->
    <Dialog :open="createOpen" @update:open="createOpen = $event">
      <DialogContent class="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>新增成員帳號</DialogTitle>
          <DialogDescription>把帳號密碼告訴家人，他們登入後可自行修改密碼。</DialogDescription>
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
          <DialogDescription>重設後該成員所有裝置會被登出。</DialogDescription>
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

    <!-- Delete confirm dialog -->
    <Dialog :open="!!deleteTarget" @update:open="(v: boolean) => { if (!v) deleteTarget = null }">
      <DialogContent class="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>確認刪除</DialogTitle>
          <DialogDescription>確定要刪除「{{ deleteTarget?.username }}」嗎？其登入與 Telegram 綁定都會移除。</DialogDescription>
        </DialogHeader>
        <DialogFooter class="gap-2 sm:gap-0">
          <DialogClose as-child><Button variant="outline">取消</Button></DialogClose>
          <Button variant="destructive" :disabled="submitting" @click="handleDelete">確認刪除</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </Card>
</template>
