<script setup lang="ts">
import { CalendarCheck, CheckCircle, ChevronDown, ChevronUp, Clock, ExternalLink, Mail, Unlink } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { SCAN_INTERVAL_OPTIONS } from '~/types/settings'

const props = defineProps<{
  google: { hasCredentials: boolean; isConnected: boolean; email: string | null }
  calendar: { calendarId: string; enabled: boolean }
  scan: { interval: number; rangeDays: number; queryExtra: string }
}>()

const emit = defineEmits<{ refresh: [] }>()

const settingsApi = useSettingsApi()

const credForm = ref({ clientId: '', clientSecret: '' })
const calendarForm = ref({ calendarId: '' })
const scanForm = ref({ rangeDays: props.scan.rangeDays, queryExtra: props.scan.queryExtra })
const submitting = ref(false)
const scanning = ref(false)
const showCredentials = ref(false)
const showAdvancedScan = ref(false)

watch(() => props.scan, (v) => {
  scanForm.value.rangeDays = v.rangeDays
  scanForm.value.queryExtra = v.queryExtra
})

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

let pollInterval: ReturnType<typeof setInterval> | null = null

onUnmounted(() => {
  if (pollInterval) clearInterval(pollInterval)
})

// --- Credentials ---

async function handleSaveCredentials() {
  if (!credForm.value.clientId || !credForm.value.clientSecret) {
    toast.error('請填寫 Client ID 和 Client Secret')
    return
  }
  submitting.value = true
  try {
    await settingsApi.saveGoogleCredentials(credForm.value.clientId, credForm.value.clientSecret)
    toast.success('Google 憑證已儲存')
    credForm.value = { clientId: '', clientSecret: '' }
    showCredentials.value = false
    emit('refresh')
  } catch (error) {
    toast.error('儲存失敗', { description: String(error) })
  } finally {
    submitting.value = false
  }
}

// --- OAuth ---

async function handleConnect() {
  try {
    const { url } = await settingsApi.startGoogleOAuth()
    window.open(url, '_blank', 'width=600,height=700')
    pollInterval = setInterval(async () => {
      const oauth = await settingsApi.getOAuthStatus()
      if (oauth.google.isConnected) {
        if (pollInterval) clearInterval(pollInterval)
        pollInterval = null
        toast.success('Google 帳號已連結')
        emit('refresh')
      }
    }, 2000)
    setTimeout(() => {
      if (pollInterval) {
        clearInterval(pollInterval)
        pollInterval = null
      }
    }, 300000)
  } catch (error) {
    toast.error('無法啟動授權流程', { description: String(error) })
  }
}

async function handleDisconnect() {
  try {
    await settingsApi.disconnectGoogle()
    toast.success('Google 帳號已斷開連結')
    emit('refresh')
  } catch (error) {
    toast.error('斷開失敗', { description: String(error) })
  }
}

// --- Actions ---

const scanLogList = ref<{ refresh: () => Promise<void> } | null>(null)

async function handleScan() {
  scanning.value = true
  try {
    const result = await settingsApi.triggerScan()
    const errorCount = result.errors?.length ?? 0
    const desc = `掃描 ${result.scanned} 封郵件，發現 ${result.newBills} 筆新帳單${errorCount > 0 ? `，${errorCount} 個錯誤（請見下方掃描紀錄）` : ''}。`
    if (errorCount > 0) {
      toast.warning('郵件掃描完成（有錯誤）', { description: desc })
    } else {
      toast.success('郵件掃描完成', { description: desc })
    }
    await scanLogList.value?.refresh()
  } catch (error) {
    toast.error('掃描失敗', { description: String(error) })
    await scanLogList.value?.refresh()
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
  } catch (error) {
    toast.error('更新失敗', { description: String(error) })
  }
}

async function handleToggleCalendar(enabled: boolean) {
  try {
    await settingsApi.toggleCalendar(enabled)
    toast.success(enabled ? '已啟用行事曆自動建立' : '已停用行事曆自動建立')
    emit('refresh')
  } catch (error) {
    toast.error('更新失敗', { description: String(error) })
  }
}

async function handleSaveCalendar() {
  if (!calendarForm.value.calendarId) {
    toast.error('請填寫 Calendar ID')
    return
  }
  submitting.value = true
  try {
    await settingsApi.saveCalendarConfig(calendarForm.value.calendarId)
    toast.success('Calendar ID 已儲存')
    calendarForm.value.calendarId = ''
    emit('refresh')
  } catch (error) {
    toast.error('儲存失敗', { description: String(error) })
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="space-y-3">
    <!-- Header -->
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-2">
        <Mail class="h-5 w-5" />
        <h3 class="text-sm font-semibold">Google（Gmail + Calendar）</h3>
        <span class="inline-flex items-center gap-1 text-xs text-muted-foreground">
          <span class="inline-block h-2 w-2 rounded-full shrink-0"
            :class="google.isConnected ? 'bg-green-500' : google.hasCredentials ? 'bg-yellow-500' : 'bg-red-500'" />
          {{ google.isConnected ? '已連結' : google.hasCredentials ? '已設定憑證，尚未授權' : '未設定' }}
        </span>
      </div>
    </div>

    <!-- State 1: No credentials — show form directly -->
    <template v-if="!google.hasCredentials">
      <p class="text-xs text-muted-foreground">
        從 Google Cloud Console → Credentials 建立 OAuth 2.0 Client ID（桌面應用程式），然後填入下方。
      </p>
      <form class="space-y-3" @submit.prevent="handleSaveCredentials">
        <div class="space-y-2">
          <Label for="gClientId">Client ID *</Label>
          <Input id="gClientId" v-model="credForm.clientId" placeholder="xxxxx.apps.googleusercontent.com" />
        </div>
        <div class="space-y-2">
          <Label for="gClientSecret">Client Secret *</Label>
          <Input id="gClientSecret" v-model="credForm.clientSecret" type="password" placeholder="GOCSPX-xxxxx" />
        </div>
        <Button type="submit" size="sm" :disabled="submitting">
          {{ submitting ? '儲存中...' : '儲存憑證' }}
        </Button>
      </form>
    </template>

    <!-- State 2: Has credentials, not connected -->
    <template v-else-if="!google.isConnected">
      <div class="flex gap-2">
        <Button size="sm" @click="handleConnect">
          <ExternalLink class="mr-2 h-4 w-4" />
          連結 Google 帳號
        </Button>
        <Button size="sm" variant="ghost" @click="showCredentials = !showCredentials">
          修改憑證
          <component :is="showCredentials ? ChevronUp : ChevronDown" class="ml-1 h-4 w-4" />
        </Button>
      </div>
      <form v-if="showCredentials" class="space-y-3 rounded-lg border border-border p-3" @submit.prevent="handleSaveCredentials">
        <div class="space-y-2">
          <Label for="gClientIdEdit">Client ID *</Label>
          <Input id="gClientIdEdit" v-model="credForm.clientId" placeholder="xxxxx.apps.googleusercontent.com" />
        </div>
        <div class="space-y-2">
          <Label for="gClientSecretEdit">Client Secret *</Label>
          <Input id="gClientSecretEdit" v-model="credForm.clientSecret" type="password" placeholder="GOCSPX-xxxxx" />
        </div>
        <div class="flex gap-2">
          <Button type="submit" size="sm" :disabled="submitting">{{ submitting ? '儲存中...' : '儲存' }}</Button>
          <Button type="button" size="sm" variant="ghost" @click="showCredentials = false">取消</Button>
        </div>
      </form>
    </template>

    <!-- State 3: Connected -->
    <template v-else>
      <div class="flex items-center gap-2 text-sm">
        <CheckCircle class="h-4 w-4 text-green-500" />
        <span>Gmail 和 Calendar 已連結</span>
        <span v-if="google.email" class="text-muted-foreground">({{ google.email }})</span>
      </div>

      <!-- Settings rows -->
      <div class="space-y-2">
        <SettingsConfigRow label="自動掃描頻率" description="定時檢查 Gmail 信箱是否有新帳單。">
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

        <SettingsConfigRow label="進階 Gmail 查詢">
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
                會附加到掃描查詢字串最後。完整查詢 =
                <code class="px-1 bg-muted rounded">(from:銀行A OR from:銀行B) newer_than:{{ scanForm.rangeDays }}d has:attachment {{ scanForm.queryExtra }}</code>
              </p>
              <Button size="sm" variant="outline" @click="handleSaveScanConfig">儲存</Button>
            </div>
          </template>
        </SettingsConfigRow>

        <SettingsConfigRow label="自動新增帳單到行事曆" description="掃描到新帳單時，自動在 Google Calendar 建立繳費截止日事件。">
          <template #icon><CalendarCheck class="h-4 w-4 text-muted-foreground" /></template>
          <Switch :checked="calendar.enabled" @update:checked="handleToggleCalendar" />
          <template v-if="calendar.enabled" #below>
            <form class="flex gap-2 mt-2 ml-6" @submit.prevent="handleSaveCalendar">
              <Input
                v-model="calendarForm.calendarId"
                :placeholder="calendar.calendarId || '輸入 Calendar ID'"
                class="flex-1"
              />
              <Button type="submit" size="sm" :disabled="submitting || !calendarForm.calendarId">
                {{ submitting ? '儲存中...' : '儲存' }}
              </Button>
            </form>
          </template>
        </SettingsConfigRow>
      </div>

      <!-- Action buttons -->
      <div class="flex gap-2">
        <Button size="sm" variant="outline" :disabled="scanning" @click="handleScan">
          <Mail class="mr-2 h-4 w-4" />
          {{ scanning ? '掃描中...' : '立即掃描郵件' }}
        </Button>
        <Button size="sm" variant="ghost" @click="showCredentials = !showCredentials">
          修改憑證
          <component :is="showCredentials ? ChevronUp : ChevronDown" class="ml-1 h-4 w-4" />
        </Button>
        <Button size="sm" variant="ghost" class="text-destructive" @click="handleDisconnect">
          <Unlink class="mr-2 h-4 w-4" />
          斷開連結
        </Button>
      </div>

      <!-- Scan history -->
      <SettingsScanLogList ref="scanLogList" />

      <!-- Expandable credentials form -->
      <form v-if="showCredentials" class="space-y-3 rounded-lg border border-border p-3" @submit.prevent="handleSaveCredentials">
        <div class="space-y-2">
          <Label for="gClientIdConnected">Client ID *</Label>
          <Input id="gClientIdConnected" v-model="credForm.clientId" placeholder="xxxxx.apps.googleusercontent.com" />
        </div>
        <div class="space-y-2">
          <Label for="gClientSecretConnected">Client Secret *</Label>
          <Input id="gClientSecretConnected" v-model="credForm.clientSecret" type="password" placeholder="GOCSPX-xxxxx" />
        </div>
        <div class="flex gap-2">
          <Button type="submit" size="sm" :disabled="submitting">{{ submitting ? '儲存中...' : '儲存' }}</Button>
          <Button type="button" size="sm" variant="ghost" @click="showCredentials = false">取消</Button>
        </div>
      </form>
    </template>
  </div>
</template>
