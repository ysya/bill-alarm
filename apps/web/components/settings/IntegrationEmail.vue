<script setup lang="ts">
import { CheckCircle, ChevronDown, ChevronUp, Clock, ExternalLink, HelpCircle, Mail, XCircle } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { SCAN_INTERVAL_OPTIONS } from '~/types/settings'

const props = defineProps<{
  email: {
    provider: 'gmail-imap'
    hasCredentials: boolean
    isConnected: boolean
    message: string
    user: string | null
    host: string
    port: number
  }
  scan: { interval: number; rangeDays: number; queryExtra: string }
}>()

const emit = defineEmits<{ refresh: [] }>()

const settingsApi = useSettingsApi()

const credForm = ref({
  host: props.email.host || 'imap.gmail.com',
  port: props.email.port || 993,
  user: props.email.user || '',
  password: '',
})
const scanForm = ref({ rangeDays: props.scan.rangeDays, queryExtra: props.scan.queryExtra })
const submitting = ref(false)
const testing = ref(false)
const testResult = ref<{ ok: boolean; message: string } | null>(null)
const scanning = ref(false)
const showCredentials = ref(false)
const showAdvancedScan = ref(false)
const helpDialogOpen = ref(false)

watch(() => props.scan, (v) => {
  scanForm.value.rangeDays = v.rangeDays
  scanForm.value.queryExtra = v.queryExtra
})

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
    } else {
      testResult.value = { ok: false, message: r.error ?? '未知錯誤' }
      toast.error('連線失敗', { description: r.error })
    }
  } catch (e) {
    testResult.value = { ok: false, message: String(e) }
    toast.error('測試失敗', { description: String(e) })
  } finally {
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
  } catch (e) {
    toast.error('儲存失敗', { description: String(e) })
  } finally {
    submitting.value = false
  }
}

async function handleSaveScanConfig() {
  try {
    await settingsApi.saveScanConfig({
      rangeDays: scanForm.value.rangeDays,
      queryExtra: scanForm.value.queryExtra,
    })
    toast.success('掃描條件已更新')
    emit('refresh')
  } catch (e) {
    toast.error('更新失敗', { description: String(e) })
  }
}

const { state: scanProgress } = useScanEvents()

const scanInProgress = computed(() => scanning.value || scanProgress.value.active)
const progressPercent = computed(() =>
  scanProgress.value.total > 0
    ? Math.round((scanProgress.value.idx / scanProgress.value.total) * 100)
    : 0,
)

async function handleScan() {
  scanning.value = true
  try {
    const result = await settingsApi.triggerScan()
    const errorCount = result.errors?.length ?? 0
    const desc = `掃描 ${result.scanned} 封郵件，發現 ${result.newBills} 筆新帳單${errorCount > 0 ? `，${errorCount} 個錯誤` : ''}。`
    const action = { label: '查看紀錄', onClick: () => navigateTo('/scan-logs') }
    if (errorCount > 0) {
      toast.warning('郵件掃描完成（有錯誤）', { description: desc, action })
    } else {
      toast.success('郵件掃描完成', { description: desc, action })
    }
  } catch (e) {
    toast.error('掃描失敗', { description: String(e) })
  } finally {
    scanning.value = false
  }
}

async function handleScanIntervalChange(value: string) {
  const interval = parseInt(value)
  try {
    await settingsApi.saveScanInterval(interval)
    const label = SCAN_INTERVAL_OPTIONS.find(o => o.value === value)?.label ?? value
    toast.success(`掃描頻率已更新為「${label}」`)
    emit('refresh')
  } catch (e) {
    toast.error('更新失敗', { description: String(e) })
  }
}
</script>

<template>
  <div class="space-y-3">
    <!-- Header -->
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-2">
        <Mail class="h-5 w-5" />
        <h3 class="text-sm font-semibold">信箱（Gmail IMAP）</h3>
        <span class="inline-flex items-center gap-1 text-xs text-muted-foreground">
          <span class="inline-block h-2 w-2 rounded-full shrink-0"
            :class="email.isConnected ? 'bg-green-500' : email.hasCredentials ? 'bg-yellow-500' : 'bg-red-500'" />
          {{ email.isConnected ? '已連線' : email.hasCredentials ? '已設定，連線失敗' : '未設定' }}
        </span>
      </div>
    </div>

    <!-- State 1: No credentials yet — show form -->
    <template v-if="!email.hasCredentials || showCredentials">
      <div class="flex items-start justify-between gap-2">
        <p class="text-xs text-muted-foreground">
          使用 Gmail App Password 直接以 IMAP 連線。完全跳過 OAuth，token 永不過期。
        </p>
        <Button type="button" size="sm" variant="ghost" class="shrink-0" @click="helpDialogOpen = true">
          <HelpCircle class="mr-1 h-4 w-4" />
          如何取得？
        </Button>
      </div>
      <form class="space-y-3" @submit.prevent="handleSaveCredentials">
        <div class="grid grid-cols-3 gap-2">
          <div class="col-span-2 space-y-2">
            <Label for="imapHost">IMAP Host</Label>
            <Input id="imapHost" v-model="credForm.host" placeholder="imap.gmail.com" />
          </div>
          <div class="space-y-2">
            <Label for="imapPort">Port</Label>
            <Input id="imapPort" v-model.number="credForm.port" type="number" placeholder="993" />
          </div>
        </div>
        <div class="space-y-2">
          <Label for="imapUser">Email *</Label>
          <Input id="imapUser" v-model="credForm.user" type="email" placeholder="you@gmail.com" />
        </div>
        <div class="space-y-2">
          <Label for="imapPass">App Password *</Label>
          <Input id="imapPass" v-model="credForm.password" type="password" placeholder="xxxx xxxx xxxx xxxx" />
        </div>

        <div v-if="testResult" class="flex items-center gap-2 text-xs"
          :class="testResult.ok ? 'text-green-500' : 'text-red-500'">
          <CheckCircle v-if="testResult.ok" class="h-4 w-4" />
          <XCircle v-else class="h-4 w-4" />
          <span>{{ testResult.message }}</span>
        </div>

        <div class="flex gap-2">
          <Button type="button" size="sm" variant="outline" :disabled="testing" @click="handleTestConnection">
            {{ testing ? '測試中...' : '測試連線' }}
          </Button>
          <Button type="submit" size="sm" :disabled="submitting">
            {{ submitting ? '儲存中...' : '儲存' }}
          </Button>
          <Button v-if="email.hasCredentials" type="button" size="sm" variant="ghost" @click="showCredentials = false">
            取消
          </Button>
        </div>
      </form>
    </template>

    <!-- State 2: Configured -->
    <template v-else>
      <div class="flex items-center gap-2 text-sm">
        <CheckCircle v-if="email.isConnected" class="h-4 w-4 text-green-500" />
        <XCircle v-else class="h-4 w-4 text-red-500" />
        <span>{{ email.isConnected ? '信箱已連線' : '信箱連線失敗' }}</span>
        <span v-if="email.user" class="text-muted-foreground">({{ email.user }})</span>
      </div>
      <p v-if="!email.isConnected" class="text-xs text-red-500">{{ email.message }}</p>

      <!-- Settings rows -->
      <div class="space-y-2">
        <SettingsConfigRow label="自動掃描頻率" description="定時檢查信箱是否有新帳單。">
          <template #icon><Clock class="h-4 w-4 text-muted-foreground" /></template>
          <Select :model-value="String(scan.interval)" @update:model-value="handleScanIntervalChange">
            <SelectTrigger class="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem v-for="opt in SCAN_INTERVAL_OPTIONS" :key="opt.value" :value="opt.value">
                {{ opt.label }}
              </SelectItem>
            </SelectContent>
          </Select>
        </SettingsConfigRow>

        <SettingsConfigRow label="掃描範圍（天）" description="從幾天前開始搜尋郵件。預設 60 天。">
          <template #icon><Clock class="h-4 w-4 text-muted-foreground" /></template>
          <div class="flex gap-2">
            <Input
              v-model.number="scanForm.rangeDays"
              type="number" min="1" max="365"
              class="w-24"
            />
            <Button size="sm" variant="outline" @click="handleSaveScanConfig">儲存</Button>
          </div>
        </SettingsConfigRow>

        <SettingsConfigRow label="進階搜尋條件">
          <template #icon><Mail class="h-4 w-4 text-muted-foreground" /></template>
          <Button size="sm" variant="ghost" @click="showAdvancedScan = !showAdvancedScan">
            {{ showAdvancedScan ? '收合' : '展開' }}
            <component :is="showAdvancedScan ? ChevronUp : ChevronDown" class="ml-1 h-4 w-4" />
          </Button>
          <template v-if="showAdvancedScan" #below>
            <div class="mt-2 ml-6 space-y-2">
              <Input
                v-model="scanForm.queryExtra"
                placeholder="例：label:bills -from:noreply"
                class="font-mono text-sm"
              />
              <p class="text-xs text-muted-foreground">
                附加到掃描查詢字串。Gmail IMAP 支援完整 Gmail 搜尋語法。完整查詢 =
                <code class="px-1 bg-muted rounded">(from:銀行A OR from:銀行B) newer_than:{{ scanForm.rangeDays }}d has:attachment {{ scanForm.queryExtra }}</code>
              </p>
              <Button size="sm" variant="outline" @click="handleSaveScanConfig">儲存</Button>
            </div>
          </template>
        </SettingsConfigRow>
      </div>

      <!-- Action buttons -->
      <div class="flex gap-2">
        <Button size="sm" variant="outline" :disabled="scanInProgress || !email.isConnected" @click="handleScan">
          <Mail class="mr-2 h-4 w-4" />
          <template v-if="scanProgress.active">
            掃描中 {{ scanProgress.idx }}/{{ scanProgress.total }}
            <span v-if="scanProgress.bank" class="ml-1 text-muted-foreground">
              · {{ scanProgress.bank }}
            </span>
          </template>
          <template v-else-if="scanning">啟動中...</template>
          <template v-else>立即掃描郵件</template>
        </Button>
        <Button size="sm" variant="ghost" @click="showCredentials = true">
          修改設定
          <ChevronDown class="ml-1 h-4 w-4" />
        </Button>
      </div>

      <!-- Live scan progress -->
      <div v-if="scanProgress.active" class="space-y-1.5 rounded-lg border border-border bg-muted/20 p-3">
        <div class="flex items-center justify-between text-xs">
          <span class="font-medium">
            {{ scanProgress.trigger === 'cron' ? '自動掃描中' : '手動掃描中' }}
            · {{ scanProgress.idx }} / {{ scanProgress.total }}
          </span>
          <span class="text-muted-foreground">{{ progressPercent }}%</span>
        </div>
        <div class="h-1.5 w-full overflow-hidden rounded-full bg-border">
          <div
            class="h-full bg-primary transition-all duration-200"
            :style="{ width: `${progressPercent}%` }"
          />
        </div>
        <p v-if="scanProgress.bank || scanProgress.lastReason" class="truncate text-xs text-muted-foreground">
          <span v-if="scanProgress.bank" class="font-medium">{{ scanProgress.bank }}</span>
          <span v-if="scanProgress.lastReason" class="ml-1">— {{ scanProgress.lastReason }}</span>
        </p>
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
                <a href="https://myaccount.google.com/security" target="_blank" class="underline inline-flex items-center gap-0.5">
                  Google 帳戶 → 安全性<ExternalLink class="h-3 w-3" />
                </a>
                打開「兩步驟驗證」。如果已開啟可略過。
              </p>
            </li>
            <li>
              <span class="font-medium">前往 App Password 頁面</span>
              <p class="text-xs text-muted-foreground mt-1">
                <a href="https://myaccount.google.com/apppasswords" target="_blank" class="underline inline-flex items-center gap-0.5">
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
              <p class="text-xs text-muted-foreground mt-1">空格可以保留，系統會自動處理。Email 欄位填你完整的 Gmail 地址。</p>
            </li>
          </ol>

          <div class="rounded-lg border border-border bg-muted/30 p-3 space-y-1.5 text-xs text-muted-foreground">
            <p class="font-medium text-foreground">常見問題</p>
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
            <Button variant="outline">了解</Button>
          </DialogClose>
          <Button as-child>
            <a href="https://myaccount.google.com/apppasswords" target="_blank">
              <ExternalLink class="mr-2 h-4 w-4" />
              開啟 App Password 頁面
            </a>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>
