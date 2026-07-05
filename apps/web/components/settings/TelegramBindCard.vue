<script setup lang="ts">
import { CheckCircle, ExternalLink, Send } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'

const settingsApi = useSettingsApi()
const { me, fetchMe } = useAuth()

const deepLink = ref<string | null>(null)
const working = ref(false)

async function startBind() {
  working.value = true
  try {
    const res = await settingsApi.telegramBind()
    deepLink.value = res.deepLink
  } catch (e: any) {
    toast.error('無法產生綁定連結', { description: e?.data?.error ?? String(e) })
  } finally {
    working.value = false
  }
}

async function confirmBind() {
  working.value = true
  try {
    await settingsApi.telegramConfirm()
    deepLink.value = null
    await fetchMe()
    toast.success('Telegram 綁定成功', { description: '之後的帳單通知會發送給你。' })
  } catch (e: any) {
    toast.error('綁定尚未完成', { description: e?.data?.error ?? String(e) })
  } finally {
    working.value = false
  }
}

async function unbind() {
  working.value = true
  try {
    await settingsApi.telegramUnbind()
    await fetchMe()
    toast.success('已解除 Telegram 綁定')
  } catch (e: any) {
    toast.error('解除綁定失敗', { description: e?.data?.error ?? String(e) })
  } finally {
    working.value = false
  }
}
</script>

<template>
  <Card class="space-y-3 p-4">
    <div class="flex items-center gap-3">
      <Send class="h-5 w-5 shrink-0 text-muted-foreground" />
      <div class="min-w-0 flex-1">
        <p class="text-sm font-medium">Telegram 通知</p>
        <p class="text-xs text-muted-foreground">
          {{ me?.telegramBound ? '已綁定，帳單通知會發送給你' : '綁定後，帳單通知會發送給你' }}
        </p>
      </div>
      <CheckCircle v-if="me?.telegramBound" class="h-4 w-4 shrink-0 text-green-500" />
    </div>

    <!-- Bound -->
    <div v-if="me?.telegramBound" class="flex justify-end">
      <Button size="sm" variant="ghost" :disabled="working" @click="unbind">解除綁定</Button>
    </div>

    <!-- Unbound, link generated: two-step guide -->
    <div v-else-if="deepLink" class="space-y-2 rounded-lg border border-border p-3">
      <p class="text-xs text-muted-foreground">1. 開啟 Telegram 並按下 <b>Start</b>；2. 回到這裡按「完成綁定」。</p>
      <div class="flex flex-wrap justify-end gap-2">
        <Button size="sm" variant="outline" as="a" :href="deepLink" target="_blank" rel="noopener">
          <ExternalLink class="mr-2 h-4 w-4" />
          開啟 Telegram
        </Button>
        <Button size="sm" :disabled="working" @click="confirmBind">完成綁定</Button>
      </div>
    </div>

    <!-- Unbound, initial -->
    <div v-else class="flex justify-end">
      <Button size="sm" :disabled="working" @click="startBind">綁定 Telegram</Button>
    </div>
  </Card>
</template>
