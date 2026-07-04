<template>
  <div class="min-h-screen flex items-center justify-center p-4">
    <Card class="w-full max-w-sm">
      <CardHeader>
        <CardTitle>初始化管理帳號</CardTitle>
        <CardDescription>首次使用，請設定登入帳號與密碼。</CardDescription>
      </CardHeader>
      <CardContent>
        <form class="flex flex-col gap-4" @submit.prevent="submit">
          <div class="flex flex-col gap-2">
            <Label for="username">帳號</Label>
            <Input id="username" v-model="username" autocomplete="username" required />
          </div>
          <div class="flex flex-col gap-2">
            <Label for="password">密碼（至少 8 碼）</Label>
            <Input id="password" v-model="password" type="password" autocomplete="new-password" minlength="8" required />
          </div>
          <div class="flex flex-col gap-2">
            <Label for="confirm">確認密碼</Label>
            <Input id="confirm" v-model="confirm" type="password" autocomplete="new-password" minlength="8" required />
          </div>
          <Button type="submit" :disabled="loading">
            {{ loading ? '設定中…' : '完成設定' }}
          </Button>
        </form>
      </CardContent>
    </Card>
  </div>
</template>

<script setup lang="ts">
import { toast } from 'vue-sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const username = ref('')
const password = ref('')
const confirm = ref('')
const loading = ref(false)

async function submit() {
  if (password.value !== confirm.value) {
    toast.error('兩次輸入的密碼不一致')
    return
  }
  loading.value = true
  try {
    await $fetch('/api/auth/setup', {
      method: 'POST',
      body: { username: username.value, password: password.value },
    })
    useAuthed().value = true
    await navigateTo('/')
  }
  catch (e) {
    const err = e as { data?: { error?: string } }
    toast.error(err.data?.error ?? '設定失敗')
  }
  finally {
    loading.value = false
  }
}
</script>
