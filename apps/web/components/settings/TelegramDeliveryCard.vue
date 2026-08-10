<script setup lang="ts">
import { CheckCircle, ExternalLink, Loader2, Send } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { apiErrorMessage, isApiErrorStatus } from '@/lib/utils'

defineProps<{
  botConfigured: boolean
}>()

const emit = defineEmits<{ refresh: [] }>()

const settingsApi = useSettingsApi()
const { me, fetchMe } = useAuth()

const POLL_INTERVAL_MS = 3000
const POLL_MAX_TRIES = 40 // ≈ 2 minutes

const deepLink = ref<string | null>(null)
const polling = ref(false)
const timedOut = ref(false)
const working = ref(false)
const testing = ref(false)
let pollTimer: ReturnType<typeof setInterval> | null = null
let tries = 0

function stopPolling() {
  if (pollTimer) clearInterval(pollTimer)
  pollTimer = null
  polling.value = false
}

onUnmounted(stopPolling)

async function startBind() {
  working.value = true
  timedOut.value = false
  try {
    const res = await settingsApi.telegramBind()
    deepLink.value = res.deepLink
    tries = 0
    polling.value = true
    pollTimer = setInterval(poll, POLL_INTERVAL_MS)
  }
  catch (e) {
    toast.error('無法產生綁定連結', { description: apiErrorMessage(e) })
  }
  finally {
    working.value = false
  }
}

/** Poll the confirm endpoint until Telegram has seen the user's Start. */
async function poll() {
  tries += 1
  try {
    await settingsApi.telegramConfirm() // 200 = bound
    stopPolling()
    deepLink.value = null
    await fetchMe()
    emit('refresh')
    toast.success('Telegram 綁定成功', { description: '之後的帳單通知會發送給你。' })
  }
  catch (e) {
    if (isApiErrorStatus(e, 410)) { // code expired server-side
      stopPolling()
      deepLink.value = null
      toast.error('綁定連結已過期，請重新產生')
      return
    }
    // 404 not_seen and transient network errors: keep waiting silently.
    if (tries >= POLL_MAX_TRIES) {
      stopPolling()
      timedOut.value = true
    }
  }
}

function retryPolling() {
  timedOut.value = false
  tries = 0
  polling.value = true
  pollTimer = setInterval(poll, POLL_INTERVAL_MS)
  void poll() // immediate first check, don't wait 3s
}

async function unbind() {
  working.value = true
  try {
    await settingsApi.telegramUnbind()
    await fetchMe()
    emit('refresh')
    toast.success('已解除 Telegram 綁定')
  }
  catch (e) {
    toast.error('解除綁定失敗', { description: apiErrorMessage(e) })
  }
  finally {
    working.value = false
  }
}

async function sendTest() {
  testing.value = true
  try {
    const result = await settingsApi.testTelegram()
    if (result.success) toast.success('測試訊息已發送', { description: '請檢查你的 Telegram。' })
    else toast.error('測試訊息發送失敗')
  }
  catch (e) {
    toast.error('發送失敗', { description: apiErrorMessage(e) })
  }
  finally {
    testing.value = false
  }
}
</script>

<template>
  <Card class="space-y-3 p-4">
    <div class="flex items-center gap-3">
      <Send class="h-5 w-5 shrink-0 text-muted-foreground" />
      <div class="min-w-0 flex-1">
        <p class="text-sm font-medium">
          送達方式：Telegram
        </p>
        <p class="text-xs text-muted-foreground">
          {{ me?.telegramBound ? '已綁定，通知會發送到你的 Telegram' : '綁定後，通知會發送到你的 Telegram' }}
        </p>
      </div>
      <CheckCircle
        v-if="me?.telegramBound"
        class="h-4 w-4 shrink-0 text-green-500"
      />
    </div>

    <!-- State 0: bot not configured — nothing to bind against -->
    <p
      v-if="!botConfigured"
      class="rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground"
    >
      管理員尚未設定 Telegram Bot，暫時無法綁定。
    </p>

    <!-- State 1: bound -->
    <div
      v-else-if="me?.telegramBound"
      class="flex flex-wrap justify-end gap-2"
    >
      <Button
        size="sm"
        variant="outline"
        :disabled="testing"
        @click="sendTest"
      >
        <Send class="mr-2 h-4 w-4" />
        {{ testing ? '發送中...' : '發送測試訊息' }}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        :disabled="working"
        @click="unbind"
      >
        解除綁定
      </Button>
    </div>

    <!-- State 2: link generated, waiting for Start -->
    <div
      v-else-if="deepLink"
      class="space-y-2 rounded-lg border border-border p-3"
    >
      <p
        v-if="polling"
        class="flex items-center gap-2 text-xs text-muted-foreground"
      >
        <Loader2 class="h-3.5 w-3.5 animate-spin" />
        等待你在 Telegram 按下 <b>Start</b>——完成後這裡會自動更新。
      </p>
      <p
        v-else-if="timedOut"
        class="text-xs text-muted-foreground"
      >
        還沒偵測到你按 Start。按過了嗎？點「重試」再檢查一次。
      </p>
      <div class="flex flex-wrap justify-end gap-2">
        <Button
          size="sm"
          variant="outline"
          as="a"
          :href="deepLink"
          target="_blank"
          rel="noopener"
        >
          <ExternalLink class="mr-2 h-4 w-4" />
          開啟 Telegram
        </Button>
        <Button
          v-if="timedOut"
          size="sm"
          @click="retryPolling"
        >
          重試
        </Button>
      </div>
    </div>

    <!-- State 3: initial -->
    <div
      v-else
      class="flex justify-end"
    >
      <Button
        size="sm"
        :disabled="working"
        @click="startBind"
      >
        綁定 Telegram
      </Button>
    </div>
  </Card>
</template>
