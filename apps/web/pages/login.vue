<template>
  <div class="min-h-screen flex items-center justify-center p-4">
    <Card class="w-full max-w-sm">
      <CardHeader>
        <CardTitle>登入 Bill Alarm</CardTitle>
      </CardHeader>
      <CardContent>
        <form class="flex flex-col gap-4" @submit.prevent="submit">
          <div class="flex flex-col gap-2">
            <Label for="username">帳號</Label>
            <Input id="username" v-model="username" autocomplete="username" required />
          </div>
          <div class="flex flex-col gap-2">
            <Label for="password">密碼</Label>
            <Input id="password" v-model="password" type="password" autocomplete="current-password" required />
          </div>
          <Button type="submit" :disabled="loading">
            {{ loading ? '登入中…' : '登入' }}
          </Button>
        </form>
      </CardContent>
    </Card>
  </div>
</template>

<script setup lang="ts">
import { toast } from 'vue-sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const username = ref('')
const password = ref('')
const loading = ref(false)

async function submit() {
  loading.value = true
  try {
    await $fetch('/api/auth/login', {
      method: 'POST',
      body: { username: username.value, password: password.value },
    })
    useAuthed().value = true
    await navigateTo('/')
  }
  catch (e) {
    const err = e as { response?: { status: number }, data?: { error?: string } }
    toast.error(err.data?.error ?? '登入失敗')
  }
  finally {
    loading.value = false
  }
}
</script>
