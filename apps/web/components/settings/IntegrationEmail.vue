<script setup lang="ts">
import { CheckCircle, ChevronDown, ExternalLink, HelpCircle, XCircle } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import type { EmailStatus } from '~/types/settings'

const props = defineProps<{
  email: EmailStatus
}>()

const emit = defineEmits<{ refresh: [] }>()

const settingsApi = useSettingsApi()

const credForm = ref({
  host: props.email.host || 'imap.gmail.com',
  port: props.email.port || 993,
  user: props.email.user || '',
  password: '',
})
const submitting = ref(false)
const testing = ref(false)
const testResult = ref<{ ok: boolean, message: string } | null>(null)
const showCredentials = ref(false)
const helpDialogOpen = ref(false)

watch(() => props.email, (v) => {
  if (!showCredentials.value) {
    credForm.value.host = v.host
    credForm.value.port = v.port
    credForm.value.user = v.user || ''
  }
})

async function handleTestConnection() {
  if (!credForm.value.user || !credForm.value.password) {
    toast.error('請填寫 Email 與 App Password')
    return
  }
  testing.value = true
  testResult.value = null
  try {
    const r = await settingsApi.testEmailConnection(credForm.value)
    if (r.ok) {
      testResult.value = { ok: true, message: `連線成功（${r.email}）` }
      toast.success('連線成功', { description: r.email })
    }
    else {
      testResult.value = { ok: false, message: r.error ?? '未知錯誤' }
      toast.error('連線失敗', { description: r.error })
    }
  }
  catch (e) {
    testResult.value = { ok: false, message: String(e) }
    toast.error('測試失敗', { description: String(e) })
  }
  finally {
    testing.value = false
  }
}

async function handleSaveCredentials() {
  if (!credForm.value.user || !credForm.value.password) {
    toast.error('請填寫 Email 與 App Password')
    return
  }
  submitting.value = true
  try {
    await settingsApi.saveEmailConfig(credForm.value)
    toast.success('信箱設定已儲存')
    credForm.value.password = ''
    showCredentials.value = false
    emit('refresh')
  }
  catch (e) {
    toast.error('儲存失敗', { description: String(e) })
  }
  finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="space-y-3">
    <!-- State 1: No credentials yet — show form -->
    <template v-if="!email.hasCredentials || showCredentials">
      <div class="flex items-start justify-between gap-2">
        <p class="text-xs text-muted-foreground">
          使用 Gmail App Password 直接以 IMAP 連線。完全跳過 OAuth，token 永不過期。
        </p>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          class="shrink-0"
          @click="helpDialogOpen = true"
        >
          <HelpCircle class="mr-1 h-4 w-4" />
          如何取得？
        </Button>
      </div>
      <form
        class="space-y-3"
        @submit.prevent="handleSaveCredentials"
      >
        <div class="grid grid-cols-3 gap-2">
          <div class="col-span-2 space-y-2">
            <Label for="imapHost">IMAP Host</Label>
            <Input
              id="imapHost"
              v-model="credForm.host"
              placeholder="imap.gmail.com"
            />
          </div>
          <div class="space-y-2">
            <Label for="imapPort">Port</Label>
            <Input
              id="imapPort"
              v-model.number="credForm.port"
              type="number"
              placeholder="993"
            />
          </div>
        </div>
        <div class="space-y-2">
          <Label for="imapUser">Email *</Label>
          <Input
            id="imapUser"
            v-model="credForm.user"
            type="email"
            placeholder="you@gmail.com"
          />
        </div>
        <div class="space-y-2">
          <Label for="imapPass">App Password *</Label>
          <Input
            id="imapPass"
            v-model="credForm.password"
            type="password"
            placeholder="xxxx xxxx xxxx xxxx"
          />
        </div>

        <div
          v-if="testResult"
          class="flex items-center gap-2 text-xs"
          :class="testResult.ok ? 'text-green-500' : 'text-red-500'"
        >
          <CheckCircle
            v-if="testResult.ok"
            class="h-4 w-4"
          />
          <XCircle
            v-else
            class="h-4 w-4"
          />
          <span>{{ testResult.message }}</span>
        </div>

        <div class="flex flex-wrap items-center justify-between gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            :disabled="testing"
            @click="handleTestConnection"
          >
            {{ testing ? '測試中...' : '測試連線' }}
          </Button>
          <div class="flex gap-2">
            <Button
              v-if="email.hasCredentials"
              type="button"
              size="sm"
              variant="ghost"
              @click="showCredentials = false"
            >
              取消
            </Button>
            <Button
              type="submit"
              size="sm"
              :disabled="submitting"
            >
              {{ submitting ? '儲存中...' : '儲存' }}
            </Button>
          </div>
        </div>
      </form>
    </template>

    <!-- State 2: Configured -->
    <template v-else>
      <Alert
        v-if="!email.connected"
        variant="destructive"
      >
        <XCircle class="h-4 w-4" />
        <AlertTitle>信箱連線失敗</AlertTitle>
        <AlertDescription>
          <span
            v-if="email.user"
            class="mr-1"
          >（{{ email.user }}）</span>{{ email.message }}
        </AlertDescription>
      </Alert>
      <div
        v-else
        class="flex flex-wrap items-center justify-between gap-2"
      >
        <div class="flex items-center gap-2 text-sm">
          <CheckCircle class="h-4 w-4 text-green-500" />
          <span>信箱已連線</span>
          <span
            v-if="email.user"
            class="text-muted-foreground"
          >({{ email.user }})</span>
        </div>
        <Button
          size="sm"
          variant="ghost"
          @click="showCredentials = true"
        >
          修改授權
          <ChevronDown class="ml-1 h-4 w-4" />
        </Button>
      </div>
      <!-- 連線失敗時也要能進表單修正 -->
      <div
        v-if="!email.connected"
        class="flex justify-end"
      >
        <Button
          size="sm"
          variant="ghost"
          @click="showCredentials = true"
        >
          修改授權
          <ChevronDown class="ml-1 h-4 w-4" />
        </Button>
      </div>
    </template>

    <!-- App Password 取得方式 Dialog -->
    <Dialog v-model:open="helpDialogOpen">
      <DialogContent class="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>如何取得 Gmail App Password</DialogTitle>
          <DialogDescription>
            App Password 是 Google 為個別應用程式產生的 16 字密碼，與你的 Google 帳號密碼分開，可隨時撤銷。
          </DialogDescription>
        </DialogHeader>

        <div class="space-y-4 text-sm">
          <ol class="space-y-3 list-decimal pl-5">
            <li>
              <span class="font-medium">啟用兩階段驗證</span>（必要前置）
              <p class="text-xs text-muted-foreground mt-1">
                到
                <a
                  href="https://myaccount.google.com/security"
                  target="_blank"
                  class="underline inline-flex items-center gap-0.5"
                >
                  Google 帳戶 → 安全性<ExternalLink class="h-3 w-3" />
                </a>
                打開「兩步驟驗證」。如果已開啟可略過。
              </p>
            </li>
            <li>
              <span class="font-medium">前往 App Password 頁面</span>
              <p class="text-xs text-muted-foreground mt-1">
                <a
                  href="https://myaccount.google.com/apppasswords"
                  target="_blank"
                  class="underline inline-flex items-center gap-0.5"
                >
                  myaccount.google.com/apppasswords<ExternalLink class="h-3 w-3" />
                </a>
              </p>
            </li>
            <li>
              <span class="font-medium">輸入應用程式名稱</span>（隨意，例如 <code class="px-1 bg-muted rounded text-xs">Bill Alarm</code>）然後點「建立」
            </li>
            <li>
              <span class="font-medium">複製 16 字密碼</span>
              <p class="text-xs text-muted-foreground mt-1">
                會顯示形如 <code class="px-1 bg-muted rounded text-xs">abcd efgh ijkl mnop</code> 的密碼，
                <strong class="text-foreground">這是唯一一次顯示的機會</strong>，視窗關閉後就看不到了。
              </p>
            </li>
            <li>
              <span class="font-medium">貼到上方「App Password」欄位</span>
              <p class="text-xs text-muted-foreground mt-1">
                空格可以保留，系統會自動處理。Email 欄位填你完整的 Gmail 地址。
              </p>
            </li>
          </ol>

          <div class="rounded-lg border border-border bg-muted/30 p-3 space-y-1.5 text-xs text-muted-foreground">
            <p class="font-medium text-foreground">
              常見問題
            </p>
            <p>
              <span class="font-medium">看不到 App Password 選項？</span>
              代表還沒開兩階段驗證，或你的帳戶被組織限制（例如公司 Google Workspace 鎖了）。
            </p>
            <p>
              <span class="font-medium">想撤銷？</span>
              到同一頁找到對應的應用程式按「移除」，立即失效。
            </p>
            <p>
              <span class="font-medium">安全嗎？</span>
              App Password 只能存取信箱，無法用來登入 Google 帳戶或變更設定，且可隨時撤銷。
            </p>
          </div>
        </div>

        <DialogFooter>
          <DialogClose as-child>
            <Button variant="outline">
              了解
            </Button>
          </DialogClose>
          <Button as-child>
            <a
              href="https://myaccount.google.com/apppasswords"
              target="_blank"
            >
              <ExternalLink class="mr-2 h-4 w-4" />
              開啟 App Password 頁面
            </a>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>
