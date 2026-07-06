<script setup lang="ts">
import { CheckCircle, ChevronDown, ChevronUp, Send } from 'lucide-vue-next'
import { toast } from 'vue-sonner'

const props = defineProps<{
  status: { isConfigured: boolean; boundCount: number }
}>()

const emit = defineEmits<{ refresh: [] }>()

const settingsApi = useSettingsApi()
const botToken = ref('')
const submitting = ref(false)
const testingTelegram = ref(false)
const showEditForm = ref(false)

async function handleSave() {
  if (!botToken.value) {
    toast.error('請填寫 Bot Token')
    return
  }
  submitting.value = true
  try {
    await settingsApi.saveTelegramConfig(botToken.value)
    toast.success('Telegram 設定已儲存')
    botToken.value = ''
    showEditForm.value = false
    emit('refresh')
  } catch (error) {
    toast.error('儲存失敗', { description: String(error) })
  } finally {
    submitting.value = false
  }
}

async function handleTest() {
  testingTelegram.value = true
  try {
    const result = await settingsApi.testTelegram()
    if (result.success) toast.success('測試訊息已發送', { description: '請檢查你的 Telegram。' })
    else toast.error('測試訊息發送失敗')
  } catch (e: any) {
    toast.error('發送失敗', { description: e?.data?.error ?? String(e) })
  } finally {
    testingTelegram.value = false
  }
}
</script>

<template>
  <div class="space-y-3">
    <!-- Not configured: token form -->
    <template v-if="!status.isConfigured">
      <p class="text-xs text-muted-foreground">
        透過 @BotFather 建立 Bot 取得 Token。每位使用者在「帳號」區各自綁定接收通知。
      </p>
      <form class="space-y-3" @submit.prevent="handleSave">
        <div class="space-y-2">
          <Label for="tBotToken">Bot Token *</Label>
          <Input id="tBotToken" v-model="botToken" type="password" placeholder="123456:ABC-DEF..." />
        </div>
        <div class="flex justify-end">
          <Button type="submit" size="sm" :disabled="submitting">
            {{ submitting ? '儲存中...' : '儲存' }}
          </Button>
        </div>
      </form>
    </template>

    <!-- Configured -->
    <template v-else>
      <div class="flex items-center gap-2 text-sm">
        <CheckCircle class="h-4 w-4 text-green-500" />
        <span>Bot 已設定 · 已綁定 {{ status.boundCount }} 人</span>
      </div>
      <p v-if="status.boundCount === 0" class="text-xs text-yellow-500">
        目前沒有任何使用者綁定，通知不會發送。請到「帳號」區綁定 Telegram。
      </p>
      <div class="flex gap-2">
        <Button size="sm" variant="outline" :disabled="testingTelegram" @click="handleTest">
          <Send class="mr-2 h-4 w-4" />
          {{ testingTelegram ? '發送中...' : '發送測試（給自己）' }}
        </Button>
        <Button size="sm" variant="ghost" @click="showEditForm = !showEditForm">
          修改 Token
          <component :is="showEditForm ? ChevronUp : ChevronDown" class="ml-1 h-4 w-4" />
        </Button>
      </div>

      <form v-if="showEditForm" class="space-y-3 rounded-lg border border-border p-3" @submit.prevent="handleSave">
        <div class="space-y-2">
          <Label for="tBotTokenEdit">Bot Token *</Label>
          <Input id="tBotTokenEdit" v-model="botToken" type="password" placeholder="輸入新的 Bot Token" />
        </div>
        <div class="flex justify-end gap-2">
          <Button type="button" size="sm" variant="ghost" @click="showEditForm = false; botToken = ''">
            取消
          </Button>
          <Button type="submit" size="sm" :disabled="submitting">
            {{ submitting ? '儲存中...' : '儲存' }}
          </Button>
        </div>
      </form>
    </template>
  </div>
</template>
