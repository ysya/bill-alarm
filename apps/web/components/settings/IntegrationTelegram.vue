<script setup lang="ts">
import { CheckCircle, ChevronDown, ChevronUp, Send } from 'lucide-vue-next'
import { toast } from 'vue-sonner'

const props = defineProps<{
  status: { isConfigured: boolean; chatId: string | null }
}>()

const emit = defineEmits<{ refresh: [] }>()

const settingsApi = useSettingsApi()
const form = ref({ botToken: '', chatId: '' })
const submitting = ref(false)
const testingTelegram = ref(false)
const showEditForm = ref(false)

async function handleSave() {
  if (!form.value.botToken || !form.value.chatId) {
    toast.error('請填寫 Bot Token 和 Chat ID')
    return
  }
  submitting.value = true
  try {
    await settingsApi.saveTelegramConfig(form.value.botToken, form.value.chatId)
    toast.success('Telegram 設定已儲存')
    form.value = { botToken: '', chatId: '' }
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
  } catch (error) {
    toast.error('發送失敗', { description: String(error) })
  } finally {
    testingTelegram.value = false
  }
}
</script>

<template>
  <div class="space-y-3">
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

    <!-- Not configured: show setup form directly -->
    <template v-if="!status.isConfigured">
      <p class="text-xs text-muted-foreground">
        透過 @BotFather 建立 Bot 取得 Token，再用 @userinfobot 取得你的 Chat ID。
      </p>
      <form class="space-y-3" @submit.prevent="handleSave">
        <div class="space-y-2">
          <Label for="tBotToken">Bot Token *</Label>
          <Input id="tBotToken" v-model="form.botToken" type="password" placeholder="123456:ABC-DEF..." />
        </div>
        <div class="space-y-2">
          <Label for="tChatId">Chat ID *</Label>
          <Input id="tChatId" v-model="form.chatId" placeholder="123456789" />
        </div>
        <Button type="submit" size="sm" :disabled="submitting">
          {{ submitting ? '儲存中...' : '儲存' }}
        </Button>
      </form>
    </template>

    <!-- Configured: show status + actions -->
    <template v-else>
      <div class="flex items-center gap-2 text-sm">
        <CheckCircle class="h-4 w-4 text-green-500" />
        <span>Chat ID: {{ status.chatId }}</span>
      </div>
      <div class="flex gap-2">
        <Button size="sm" variant="outline" :disabled="testingTelegram" @click="handleTest">
          <Send class="mr-2 h-4 w-4" />
          {{ testingTelegram ? '發送中...' : '發送測試' }}
        </Button>
        <Button size="sm" variant="ghost" @click="showEditForm = !showEditForm">
          修改設定
          <component :is="showEditForm ? ChevronUp : ChevronDown" class="ml-1 h-4 w-4" />
        </Button>
      </div>

      <!-- Expandable edit form -->
      <form v-if="showEditForm" class="space-y-3 rounded-lg border border-border p-3" @submit.prevent="handleSave">
        <p class="text-xs text-muted-foreground">
          透過 @BotFather 建立 Bot 取得 Token，再用 @userinfobot 取得你的 Chat ID。
        </p>
        <div class="space-y-2">
          <Label for="tBotTokenEdit">Bot Token *</Label>
          <Input id="tBotTokenEdit" v-model="form.botToken" type="password" placeholder="輸入新的 Bot Token" />
        </div>
        <div class="space-y-2">
          <Label for="tChatIdEdit">Chat ID *</Label>
          <Input id="tChatIdEdit" v-model="form.chatId" placeholder="輸入新的 Chat ID" />
        </div>
        <div class="flex gap-2">
          <Button type="submit" size="sm" :disabled="submitting">
            {{ submitting ? '儲存中...' : '儲存' }}
          </Button>
          <Button type="button" size="sm" variant="ghost" @click="showEditForm = false; form = { botToken: '', chatId: '' }">
            取消
          </Button>
        </div>
      </form>
    </template>
  </div>
</template>
