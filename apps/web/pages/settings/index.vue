<script setup lang="ts">
import { Bell, CalendarCheck, CheckCircle, ExternalLink, Link2, Mail, Pencil, Plus, Send, Trash2, Unlink, XCircle } from 'lucide-vue-next'
import { toast } from 'vue-sonner'

// -------------------------------------------------------------------
// Types
// -------------------------------------------------------------------

interface NotificationRule {
  id: string
  name: string
  daysBefore: number
  timeOfDay: string
  channels: string[]
  isActive: boolean
}

interface IntegrationStatus {
  gmail: { connected: boolean; message: string }
  telegram: { configured: boolean }
  calendar: { configured: boolean }
}

interface OAuthStatus {
  google: { hasCredentials: boolean; isConnected: boolean; email: string | null }
  telegram: { isConfigured: boolean; chatId: string | null }
  calendar: { calendarId: string }
  gemini: { isConfigured: boolean }
}

const CHANNEL_OPTIONS = [
  { value: 'telegram', label: 'Telegram' },
  { value: 'calendar', label: 'Google Calendar' },
] as const

// -------------------------------------------------------------------
// State
// -------------------------------------------------------------------

const settingsApi = useSettingsApi()

const rules = ref<NotificationRule[]>([])
const integrations = ref<IntegrationStatus | null>(null)
const oauthStatus = ref<OAuthStatus | null>(null)
const loading = ref(true)

// Rule dialog
const dialogOpen = ref(false)
const deleteDialogOpen = ref(false)
const editingRule = ref<NotificationRule | null>(null)
const deletingRule = ref<NotificationRule | null>(null)
const submitting = ref(false)

// Integration actions
const scanning = ref(false)
const testingTelegram = ref(false)

// Config dialogs
const googleCredDialogOpen = ref(false)
const telegramDialogOpen = ref(false)
const calendarDialogOpen = ref(false)
const geminiDialogOpen = ref(false)

const googleCredForm = ref({ clientId: '', clientSecret: '' })
const telegramForm = ref({ botToken: '', chatId: '' })
const geminiForm = ref({ apiKey: '' })
const calendarForm = ref({ calendarId: '' })

const defaultForm = {
  name: '',
  daysBefore: 3,
  timeOfDay: '09:00',
  channels: [] as string[],
  isActive: true,
}
const form = ref({ ...defaultForm })

const dialogTitle = computed(() => editingRule.value ? '編輯通知規則' : '新增通知規則')
const dialogDescription = computed(() =>
  editingRule.value
    ? '修改通知規則的觸發條件與通知頻道。'
    : '建立新的通知規則，在帳單到期前提醒你繳費。',
)

// -------------------------------------------------------------------
// Data fetching
// -------------------------------------------------------------------

async function fetchData() {
  loading.value = true
  try {
    const [ruleList, status, oauth] = await Promise.all([
      settingsApi.listRules(),
      settingsApi.getIntegrationStatus(),
      settingsApi.getOAuthStatus(),
    ])
    rules.value = ruleList
    integrations.value = status
    oauthStatus.value = oauth
  } catch (error) {
    toast.error('載入設定失敗', { description: String(error) })
  } finally {
    loading.value = false
  }
}

// -------------------------------------------------------------------
// Rule CRUD
// -------------------------------------------------------------------

function openCreateDialog() {
  editingRule.value = null
  form.value = { ...defaultForm, channels: [] }
  dialogOpen.value = true
}

function openEditDialog(rule: NotificationRule) {
  editingRule.value = rule
  form.value = {
    name: rule.name,
    daysBefore: rule.daysBefore,
    timeOfDay: rule.timeOfDay,
    channels: [...rule.channels],
    isActive: rule.isActive,
  }
  dialogOpen.value = true
}

function openDeleteDialog(rule: NotificationRule) {
  deletingRule.value = rule
  deleteDialogOpen.value = true
}

function toggleChannel(channel: string) {
  const idx = form.value.channels.indexOf(channel)
  if (idx === -1) form.value.channels.push(channel)
  else form.value.channels.splice(idx, 1)
}

async function handleSubmit() {
  if (!form.value.name.trim()) { toast.error('請填寫規則名稱'); return }
  if (form.value.daysBefore < 0) { toast.error('天數不可為負數'); return }
  if (form.value.channels.length === 0) { toast.error('請至少選擇一個通知頻道'); return }

  submitting.value = true
  const payload = {
    name: form.value.name.trim(),
    daysBefore: form.value.daysBefore,
    timeOfDay: form.value.timeOfDay,
    channels: form.value.channels,
    isActive: form.value.isActive,
  }

  try {
    if (editingRule.value) {
      await settingsApi.updateRule(editingRule.value.id, payload)
      toast.success('通知規則已更新')
    } else {
      await settingsApi.createRule(payload)
      toast.success('通知規則已新增')
    }
    dialogOpen.value = false
    await fetchData()
  } catch (error) {
    toast.error('操作失敗', { description: String(error) })
  } finally {
    submitting.value = false
  }
}

async function handleDelete() {
  if (!deletingRule.value) return
  submitting.value = true
  try {
    await settingsApi.deleteRule(deletingRule.value.id)
    toast.success('通知規則已刪除')
    deleteDialogOpen.value = false
    await fetchData()
  } catch (error) {
    toast.error('刪除失敗', { description: String(error) })
  } finally {
    submitting.value = false
  }
}

async function handleToggleActive(rule: NotificationRule) {
  try {
    await settingsApi.updateRule(rule.id, { isActive: !rule.isActive })
    rule.isActive = !rule.isActive
    toast.success(rule.isActive ? '規則已啟用' : '規則已停用')
  } catch (error) {
    toast.error('更新失敗', { description: String(error) })
  }
}

// -------------------------------------------------------------------
// Google OAuth
// -------------------------------------------------------------------

async function handleSaveGoogleCred() {
  if (!googleCredForm.value.clientId || !googleCredForm.value.clientSecret) {
    toast.error('請填寫 Client ID 和 Client Secret')
    return
  }
  submitting.value = true
  try {
    await settingsApi.saveGoogleCredentials(googleCredForm.value.clientId, googleCredForm.value.clientSecret)
    toast.success('Google 憑證已儲存')
    googleCredDialogOpen.value = false
    await fetchData()
  } catch (error) {
    toast.error('儲存失敗', { description: String(error) })
  } finally {
    submitting.value = false
  }
}

async function handleConnectGoogle() {
  try {
    const { url } = await settingsApi.startGoogleOAuth()
    window.open(url, '_blank', 'width=600,height=700')
    // Poll for connection status after user completes OAuth
    const poll = setInterval(async () => {
      const oauth = await settingsApi.getOAuthStatus()
      if (oauth.google.isConnected) {
        clearInterval(poll)
        toast.success('Google 帳號已連結')
        await fetchData()
      }
    }, 2000)
    // Stop polling after 5 minutes
    setTimeout(() => clearInterval(poll), 300000)
  } catch (error) {
    toast.error('無法啟動授權流程', { description: String(error) })
  }
}

async function handleDisconnectGoogle() {
  try {
    await settingsApi.disconnectGoogle()
    toast.success('Google 帳號已斷開連結')
    await fetchData()
  } catch (error) {
    toast.error('斷開失敗', { description: String(error) })
  }
}

// -------------------------------------------------------------------
// Telegram Config
// -------------------------------------------------------------------

async function handleSaveTelegram() {
  if (!telegramForm.value.botToken || !telegramForm.value.chatId) {
    toast.error('請填寫 Bot Token 和 Chat ID')
    return
  }
  submitting.value = true
  try {
    await settingsApi.saveTelegramConfig(telegramForm.value.botToken, telegramForm.value.chatId)
    toast.success('Telegram 設定已儲存')
    telegramDialogOpen.value = false
    await fetchData()
  } catch (error) {
    toast.error('儲存失敗', { description: String(error) })
  } finally {
    submitting.value = false
  }
}

// -------------------------------------------------------------------
// Calendar Config
// -------------------------------------------------------------------

async function handleSaveCalendar() {
  if (!calendarForm.value.calendarId) {
    toast.error('請填寫 Calendar ID')
    return
  }
  submitting.value = true
  try {
    await settingsApi.saveCalendarConfig(calendarForm.value.calendarId)
    toast.success('Calendar 設定已儲存')
    calendarDialogOpen.value = false
    await fetchData()
  } catch (error) {
    toast.error('儲存失敗', { description: String(error) })
  } finally {
    submitting.value = false
  }
}

// -------------------------------------------------------------------
// Gemini Config
// -------------------------------------------------------------------

async function handleSaveGemini() {
  if (!geminiForm.value.apiKey) {
    toast.error('請填寫 Gemini API Key')
    return
  }
  submitting.value = true
  try {
    await settingsApi.saveGeminiConfig(geminiForm.value.apiKey)
    toast.success('Gemini API Key 已儲存')
    geminiDialogOpen.value = false
    await fetchData()
  } catch (error) {
    toast.error('儲存失敗', { description: String(error) })
  } finally {
    submitting.value = false
  }
}

// -------------------------------------------------------------------
// Integration actions
// -------------------------------------------------------------------

async function handleScan() {
  scanning.value = true
  try {
    const result = await settingsApi.triggerScan()
    toast.success('郵件掃描完成', {
      description: `掃描 ${result.scanned} 封郵件，發現 ${result.newBills} 筆新帳單。`,
    })
  } catch (error) {
    toast.error('掃描失敗', { description: String(error) })
  } finally {
    scanning.value = false
  }
}

async function handleTestTelegram() {
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

function formatChannelLabel(channel: string): string {
  return channel === 'telegram' ? 'Telegram' : channel === 'calendar' ? 'Calendar' : channel
}

onMounted(fetchData)
</script>

<template>
  <div class="space-y-8">
    <!-- Page Header -->
    <div>
      <h1 class="text-2xl font-bold tracking-tight">設定</h1>
      <p class="text-sm text-muted-foreground mt-1">管理通知規則與第三方服務整合。</p>
    </div>

    <Separator />

    <!-- ============================================================= -->
    <!-- Section 1: Integrations (moved up for importance)              -->
    <!-- ============================================================= -->
    <section class="space-y-4">
      <div>
        <h2 class="text-lg font-semibold flex items-center gap-2">
          <Link2 class="h-5 w-5" />
          服務整合
        </h2>
        <p class="text-sm text-muted-foreground mt-0.5">連結 Google 和 Telegram 帳號，啟用自動化功能。</p>
      </div>

      <!-- Loading -->
      <div v-if="loading" class="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card v-for="i in 3" :key="i" class="animate-pulse">
          <CardHeader class="pb-3"><div class="h-5 w-24 bg-muted rounded" /></CardHeader>
          <CardContent><div class="h-9 w-full bg-muted rounded" /></CardContent>
        </Card>
      </div>

      <div v-else-if="oauthStatus" class="grid grid-cols-1 md:grid-cols-3 gap-4">
        <!-- Google (Gmail + Calendar) -->
        <Card class="md:col-span-2">
          <CardHeader class="pb-3">
            <CardTitle class="text-sm font-medium flex items-center gap-2">
              <Mail class="h-4 w-4" />
              Google（Gmail + Calendar）
            </CardTitle>
            <CardDescription class="flex items-center gap-1.5">
              <span class="inline-block h-2 w-2 rounded-full shrink-0"
                :class="oauthStatus.google.isConnected ? 'bg-green-500' : oauthStatus.google.hasCredentials ? 'bg-yellow-500' : 'bg-red-500'"
              />
              {{ oauthStatus.google.isConnected ? '已連結' : oauthStatus.google.hasCredentials ? '已設定憑證，尚未授權' : '未設定' }}
            </CardDescription>
          </CardHeader>
          <CardContent class="space-y-3">
            <!-- Step 1: Set credentials -->
            <div v-if="!oauthStatus.google.hasCredentials" class="space-y-2">
              <p class="text-sm text-muted-foreground">
                需要先設定 Google Cloud OAuth 憑證。
              </p>
              <Button size="sm" variant="outline" @click="googleCredDialogOpen = true">
                設定 Google 憑證
              </Button>
            </div>

            <!-- Step 2: Connect -->
            <div v-else-if="!oauthStatus.google.isConnected" class="flex gap-2">
              <Button size="sm" @click="handleConnectGoogle">
                <ExternalLink class="mr-2 h-4 w-4" />
                連結 Google 帳號
              </Button>
              <Button size="sm" variant="ghost" @click="googleCredDialogOpen = true">
                修改憑證
              </Button>
            </div>

            <!-- Step 3: Connected -->
            <div v-else class="space-y-3">
              <div class="flex items-center gap-2 text-sm">
                <CheckCircle class="h-4 w-4 text-green-500" />
                <span>Gmail 和 Calendar 已連結</span>
                <span v-if="oauthStatus.google.email" class="text-muted-foreground">({{ oauthStatus.google.email }})</span>
              </div>
              <div class="flex gap-2">
                <Button size="sm" variant="outline" :disabled="scanning" @click="handleScan">
                  <Mail class="mr-2 h-4 w-4" />
                  {{ scanning ? '掃描中...' : '立即掃描郵件' }}
                </Button>
                <Button size="sm" variant="ghost" class="text-destructive" @click="handleDisconnectGoogle">
                  <Unlink class="mr-2 h-4 w-4" />
                  斷開連結
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <!-- Telegram -->
        <Card>
          <CardHeader class="pb-3">
            <CardTitle class="text-sm font-medium flex items-center gap-2">
              <Send class="h-4 w-4" />
              Telegram
            </CardTitle>
            <CardDescription class="flex items-center gap-1.5">
              <span class="inline-block h-2 w-2 rounded-full shrink-0"
                :class="oauthStatus.telegram.isConfigured ? 'bg-green-500' : 'bg-red-500'"
              />
              {{ oauthStatus.telegram.isConfigured ? '已設定' : '未設定' }}
            </CardDescription>
          </CardHeader>
          <CardContent class="space-y-2">
            <div v-if="oauthStatus.telegram.isConfigured" class="space-y-2">
              <div class="flex items-center gap-2 text-sm">
                <CheckCircle class="h-4 w-4 text-green-500" />
                <span>Chat ID: {{ oauthStatus.telegram.chatId }}</span>
              </div>
              <div class="flex gap-2">
                <Button size="sm" variant="outline" :disabled="testingTelegram" @click="handleTestTelegram">
                  <Send class="mr-2 h-4 w-4" />
                  {{ testingTelegram ? '發送中...' : '發送測試' }}
                </Button>
                <Button size="sm" variant="ghost" @click="telegramDialogOpen = true">
                  修改設定
                </Button>
              </div>
            </div>
            <Button v-else size="sm" variant="outline" @click="telegramDialogOpen = true">
              設定 Telegram Bot
            </Button>
          </CardContent>
        </Card>

        <!-- Gemini (LLM for PDF parsing) -->
        <Card>
          <CardHeader class="pb-3">
            <CardTitle class="text-sm font-medium flex items-center gap-2">
              Gemini AI
            </CardTitle>
            <CardDescription class="flex items-center gap-1.5">
              <span class="inline-block h-2 w-2 rounded-full shrink-0"
                :class="oauthStatus.gemini.isConfigured ? 'bg-green-500' : 'bg-red-500'"
              />
              {{ oauthStatus.gemini.isConfigured ? '已設定' : '未設定' }}
            </CardDescription>
          </CardHeader>
          <CardContent class="space-y-2">
            <p class="text-xs text-muted-foreground">用於自動解析 PDF 帳單內容（金額、截止日）。</p>
            <Button size="sm" variant="outline" @click="geminiDialogOpen = true">
              {{ oauthStatus.gemini.isConfigured ? '修改 API Key' : '設定 Gemini API Key' }}
            </Button>
          </CardContent>
        </Card>
      </div>
    </section>

    <Separator />

    <!-- ============================================================= -->
    <!-- Section 2: Notification Rules                                  -->
    <!-- ============================================================= -->
    <section class="space-y-4">
      <div class="flex items-center justify-between">
        <div>
          <h2 class="text-lg font-semibold flex items-center gap-2">
            <Bell class="h-5 w-5" />
            通知規則
          </h2>
          <p class="text-sm text-muted-foreground mt-0.5">設定帳單到期前的提醒方式與時間。</p>
        </div>
        <Button size="sm" @click="openCreateDialog">
          <Plus class="mr-2 h-4 w-4" />
          新增規則
        </Button>
      </div>

      <!-- Loading -->
      <div v-if="loading" class="space-y-3">
        <Card v-for="i in 2" :key="i" class="animate-pulse">
          <CardContent class="p-4">
            <div class="flex items-center justify-between">
              <div class="space-y-2"><div class="h-4 w-40 bg-muted rounded" /><div class="h-3 w-56 bg-muted rounded" /></div>
              <div class="h-5 w-10 bg-muted rounded-full" />
            </div>
          </CardContent>
        </Card>
      </div>

      <!-- Empty -->
      <Card v-else-if="rules.length === 0">
        <CardContent class="flex flex-col items-center justify-center py-12 text-center">
          <div class="rounded-full bg-muted p-4 mb-4"><Bell class="h-8 w-8 text-muted-foreground" /></div>
          <h3 class="text-lg font-semibold">尚未設定通知規則</h3>
          <p class="text-sm text-muted-foreground mt-1 max-w-sm">建立規則後，系統會在帳單到期前透過指定頻道提醒你。</p>
          <Button class="mt-4" size="sm" @click="openCreateDialog"><Plus class="mr-2 h-4 w-4" />建立第一條規則</Button>
        </CardContent>
      </Card>

      <!-- Rule list -->
      <div v-else class="space-y-3">
        <Card v-for="rule in rules" :key="rule.id" class="transition-colors hover:border-foreground/20">
          <CardContent class="p-4">
            <div class="flex items-center justify-between gap-4">
              <div class="min-w-0 flex-1 space-y-1.5">
                <div class="flex items-center gap-2 flex-wrap">
                  <span class="font-medium text-sm truncate">{{ rule.name }}</span>
                  <Badge v-for="ch in rule.channels" :key="ch" variant="outline" class="text-xs">{{ formatChannelLabel(ch) }}</Badge>
                </div>
                <p class="text-xs text-muted-foreground">到期前 {{ rule.daysBefore }} 天，於 {{ rule.timeOfDay }} 發送通知</p>
              </div>
              <div class="flex items-center gap-2 shrink-0">
                <Switch :checked="rule.isActive" @update:checked="handleToggleActive(rule)" />
                <Button variant="ghost" size="icon" class="h-8 w-8" @click="openEditDialog(rule)"><Pencil class="h-4 w-4" /><span class="sr-only">編輯</span></Button>
                <Button variant="ghost" size="icon" class="h-8 w-8 text-destructive hover:text-destructive" @click="openDeleteDialog(rule)"><Trash2 class="h-4 w-4" /><span class="sr-only">刪除</span></Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </section>

    <!-- ============================================================= -->
    <!-- Dialogs                                                        -->
    <!-- ============================================================= -->

    <!-- Rule Create / Edit Dialog -->
    <Dialog v-model:open="dialogOpen">
      <DialogContent class="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{{ dialogTitle }}</DialogTitle>
          <DialogDescription>{{ dialogDescription }}</DialogDescription>
        </DialogHeader>
        <form class="space-y-4 py-2" @submit.prevent="handleSubmit">
          <div class="space-y-2">
            <Label for="ruleName">規則名稱 *</Label>
            <Input id="ruleName" v-model="form.name" placeholder="例：到期前三天提醒" />
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div class="space-y-2">
              <Label for="daysBefore">提前天數 *</Label>
              <Input id="daysBefore" v-model.number="form.daysBefore" type="number" min="0" max="30" />
            </div>
            <div class="space-y-2">
              <Label for="timeOfDay">通知時間 *</Label>
              <Input id="timeOfDay" v-model="form.timeOfDay" type="time" />
            </div>
          </div>
          <div class="space-y-3">
            <Label>通知頻道 *</Label>
            <div class="flex flex-col gap-2">
              <label v-for="option in CHANNEL_OPTIONS" :key="option.value"
                class="flex items-center gap-3 rounded-lg border border-border p-3 cursor-pointer transition-colors"
                :class="form.channels.includes(option.value) ? 'border-foreground/30 bg-accent' : ''">
                <input type="checkbox" class="h-4 w-4 rounded border-border accent-primary"
                  :checked="form.channels.includes(option.value)" @change="toggleChannel(option.value)">
                <span class="text-sm font-medium">{{ option.label }}</span>
              </label>
            </div>
          </div>
          <div class="flex items-center justify-between rounded-lg border border-border p-3">
            <div class="space-y-0.5">
              <Label for="ruleIsActive" class="cursor-pointer">啟用狀態</Label>
              <p class="text-xs text-muted-foreground">停用後此規則將不會觸發通知。</p>
            </div>
            <Switch id="ruleIsActive" :checked="form.isActive" @update:checked="form.isActive = $event" />
          </div>
          <DialogFooter class="gap-2 sm:gap-0">
            <DialogClose as-child><Button type="button" variant="outline">取消</Button></DialogClose>
            <Button type="submit" :disabled="submitting">{{ editingRule ? '儲存變更' : '新增規則' }}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>

    <!-- Rule Delete Dialog -->
    <Dialog v-model:open="deleteDialogOpen">
      <DialogContent class="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>確認刪除</DialogTitle>
          <DialogDescription>確定要刪除通知規則「{{ deletingRule?.name }}」嗎？此操作無法復原。</DialogDescription>
        </DialogHeader>
        <DialogFooter class="gap-2 sm:gap-0">
          <DialogClose as-child><Button variant="outline">取消</Button></DialogClose>
          <Button variant="destructive" :disabled="submitting" @click="handleDelete">確認刪除</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- Google Credentials Dialog -->
    <Dialog v-model:open="googleCredDialogOpen">
      <DialogContent class="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>設定 Google OAuth 憑證</DialogTitle>
          <DialogDescription>
            從 Google Cloud Console → Credentials 建立 OAuth 2.0 Client ID（桌面應用程式），然後將 Client ID 和 Secret 填入下方。
          </DialogDescription>
        </DialogHeader>
        <form class="space-y-4 py-2" @submit.prevent="handleSaveGoogleCred">
          <div class="space-y-2">
            <Label for="gClientId">Client ID *</Label>
            <Input id="gClientId" v-model="googleCredForm.clientId" placeholder="xxxxx.apps.googleusercontent.com" />
          </div>
          <div class="space-y-2">
            <Label for="gClientSecret">Client Secret *</Label>
            <Input id="gClientSecret" v-model="googleCredForm.clientSecret" type="password" placeholder="GOCSPX-xxxxx" />
          </div>
          <DialogFooter class="gap-2 sm:gap-0">
            <DialogClose as-child><Button type="button" variant="outline">取消</Button></DialogClose>
            <Button type="submit" :disabled="submitting">儲存</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>

    <!-- Telegram Config Dialog -->
    <Dialog v-model:open="telegramDialogOpen">
      <DialogContent class="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>設定 Telegram Bot</DialogTitle>
          <DialogDescription>
            透過 @BotFather 建立 Bot 取得 Token，再用 @userinfobot 取得你的 Chat ID。
          </DialogDescription>
        </DialogHeader>
        <form class="space-y-4 py-2" @submit.prevent="handleSaveTelegram">
          <div class="space-y-2">
            <Label for="tBotToken">Bot Token *</Label>
            <Input id="tBotToken" v-model="telegramForm.botToken" type="password" placeholder="123456:ABC-DEF..." />
          </div>
          <div class="space-y-2">
            <Label for="tChatId">Chat ID *</Label>
            <Input id="tChatId" v-model="telegramForm.chatId" placeholder="123456789" />
          </div>
          <DialogFooter class="gap-2 sm:gap-0">
            <DialogClose as-child><Button type="button" variant="outline">取消</Button></DialogClose>
            <Button type="submit" :disabled="submitting">儲存</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>

    <!-- Gemini Config Dialog -->
    <Dialog v-model:open="geminiDialogOpen">
      <DialogContent class="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>設定 Gemini API Key</DialogTitle>
          <DialogDescription>
            到 aistudio.google.com 免費產生 API Key。用於自動解析 PDF 帳單內容。
          </DialogDescription>
        </DialogHeader>
        <form class="space-y-4 py-2" @submit.prevent="handleSaveGemini">
          <div class="space-y-2">
            <Label for="geminiKey">API Key *</Label>
            <Input id="geminiKey" v-model="geminiForm.apiKey" type="password" placeholder="AIzaSy..." />
          </div>
          <DialogFooter class="gap-2 sm:gap-0">
            <DialogClose as-child><Button type="button" variant="outline">取消</Button></DialogClose>
            <Button type="submit" :disabled="submitting">儲存</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  </div>
</template>
