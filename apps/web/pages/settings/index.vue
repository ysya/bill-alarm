<script setup lang="ts">
import { CalendarCheck, Clock, KeyRound, LogOut, Mail, Send, Sparkles, User } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import type { NotificationRule, ConfigStatus, EmailStatus } from '~/types/settings'
import { LLM_PROVIDER_LABELS } from '~/types/settings'

const settingsApi = useSettingsApi()
const { me, isAdmin, logout } = useAuth()

const rules = ref<NotificationRule[]>([])
const emailStatus = ref<EmailStatus | null>(null)
const calendarFeed = ref<{ token: string; feedUrl: string; feedPath: string } | null>(null)
const configStatus = ref<ConfigStatus | null>(null)
const loading = ref(true)

// Rule dialog state
const dialogOpen = ref(false)
const editingRule = ref<NotificationRule | null>(null)
const deleteDialogOpen = ref(false)
const deletingRule = ref<NotificationRule | null>(null)
const submitting = ref(false)
const changePwOpen = ref(false)

type CardStatus = 'ok' | 'unset' | 'error'

const emailCardStatus = computed<{ status: CardStatus, text: string }>(() => {
  const e = emailStatus.value
  if (!e?.hasCredentials) return { status: 'unset', text: '未設定' }
  return e.connected ? { status: 'ok', text: '已連線' } : { status: 'error', text: '連線失敗' }
})

const telegramStatus = computed<{ status: CardStatus, text: string }>(() =>
  configStatus.value?.telegram.isConfigured
    ? { status: 'ok', text: '已設定' }
    : { status: 'unset', text: '未設定' },
)

const llmStatus = computed<{ status: CardStatus, text: string }>(() => {
  const s = configStatus.value
  if (!s || s.llm.provider === 'none') return { status: 'unset', text: '未啟用' }
  if (s.llm.provider === 'gemini' && !s.gemini.isConfigured) return { status: 'error', text: '缺 API Key' }
  if (s.llm.provider === 'openai' && !s.openai.isConfigured) return { status: 'error', text: '缺 API Key' }
  return { status: 'ok', text: LLM_PROVIDER_LABELS[s.llm.provider] }
})

async function fetchSelfData() {
  loading.value = true
  try {
    const [ruleList, email, calendar] = await Promise.all([
      settingsApi.listRules(),
      settingsApi.getEmailStatus(),
      settingsApi.getCalendarFeed(),
    ])
    rules.value = ruleList
    emailStatus.value = email
    calendarFeed.value = calendar
  } catch (error) {
    toast.error('載入設定失敗', { description: String(error) })
  } finally {
    loading.value = false
  }
}

async function fetchAdminData() {
  try {
    configStatus.value = await settingsApi.getConfigStatus()
  } catch (error) {
    toast.error('載入系統設定失敗', { description: String(error) })
  }
}

onMounted(fetchSelfData)
const adminDataFetched = ref(false)
watch(isAdmin, (admin) => {
  if (admin && !adminDataFetched.value) {
    adminDataFetched.value = true
    fetchAdminData()
  }
}, { immediate: true })

function openCreateDialog() {
  editingRule.value = null
  dialogOpen.value = true
}

function openEditDialog(rule: NotificationRule) {
  editingRule.value = rule
  dialogOpen.value = true
}

function openDeleteDialog(rule: NotificationRule) {
  deletingRule.value = rule
  deleteDialogOpen.value = true
}

async function handleDelete() {
  if (!deletingRule.value) return
  submitting.value = true
  try {
    await settingsApi.deleteRule(deletingRule.value.id)
    toast.success('通知規則已刪除')
    deleteDialogOpen.value = false
    await fetchSelfData()
  } catch (error) {
    toast.error('刪除失敗', { description: String(error) })
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="space-y-8">
    <!-- Page Header -->
    <div>
      <h1 class="text-2xl font-bold tracking-tight">設定</h1>
      <p class="text-sm text-muted-foreground mt-1">管理服務整合、通知規則與帳號。</p>
    </div>

    <!-- 服務整合（全員：自己的信箱與行事曆） -->
    <section class="space-y-3">
      <h2 class="text-sm font-medium text-muted-foreground">服務整合</h2>
      <div v-if="loading" class="space-y-3">
        <div v-for="i in 2" :key="i" class="h-12 animate-pulse rounded-xl bg-muted" />
      </div>
      <template v-else>
        <SettingsCard v-if="emailStatus" :icon="Mail" title="信箱（Gmail IMAP）" :status="emailCardStatus.status" :status-text="emailCardStatus.text">
          <SettingsIntegrationEmail :email="emailStatus" @refresh="fetchSelfData" />
        </SettingsCard>
        <SettingsCard v-if="calendarFeed" :icon="CalendarCheck" title="行事曆訂閱（ICS Feed）" status="ok" status-text="已啟用">
          <SettingsIntegrationCalendar :calendar="calendarFeed" @refresh="fetchSelfData" />
        </SettingsCard>
      </template>
    </section>

    <!-- 通知規則（全員，自己的） -->
    <section>
      <SettingsNotificationRuleList
        :rules="rules" :loading="loading"
        @create="openCreateDialog" @edit="openEditDialog" @delete="openDeleteDialog" @refresh="fetchSelfData"
      />
    </section>

    <!-- 帳號（全員） -->
    <section class="space-y-3">
      <h2 class="flex items-center gap-2 text-sm font-medium text-muted-foreground">
        <User class="h-4 w-4" />帳號
      </h2>
      <InstallPrompt variant="row" />
      <SettingsTelegramBindCard />
      <Card class="flex flex-wrap items-center justify-between gap-3 p-4">
        <div class="flex min-w-0 items-center gap-3">
          <User class="h-5 w-5 shrink-0 text-muted-foreground" />
          <div class="min-w-0">
            <p class="text-sm font-medium">登入身分</p>
            <p class="truncate text-xs text-muted-foreground">
              {{ me?.username ?? '—' }}
              <span v-if="me"> · {{ me.role === 'admin' ? '管理者' : '成員' }}</span>
            </p>
          </div>
        </div>
        <div class="flex items-center gap-2">
          <Button variant="outline" size="sm" @click="changePwOpen = true">
            <KeyRound class="mr-2 h-4 w-4" />
            修改密碼
          </Button>
          <Button
            variant="outline" size="sm"
            class="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
            @click="logout"
          >
            <LogOut class="mr-2 h-4 w-4" />
            登出
          </Button>
        </div>
      </Card>
    </section>

    <!-- 系統管理（admin） -->
    <section v-if="isAdmin" class="space-y-3">
      <h2 class="text-sm font-medium text-muted-foreground">系統管理</h2>
      <template v-if="configStatus">
        <SettingsCard :icon="Sparkles" title="AI 解析器" :status="llmStatus.status" :status-text="llmStatus.text">
          <SettingsIntegrationLLM
            :llm="configStatus.llm" :gemini="configStatus.gemini" :openai="configStatus.openai"
            @refresh="fetchAdminData"
          />
        </SettingsCard>
        <SettingsCard :icon="Send" title="Telegram Bot" :status="telegramStatus.status" :status-text="telegramStatus.text">
          <SettingsIntegrationTelegram :status="configStatus.telegram" @refresh="fetchAdminData" />
        </SettingsCard>
        <SettingsCard :icon="Clock" title="掃描設定" status="ok" status-text="全域">
          <SettingsScanConfigCard :scan="configStatus.scan" @refresh="fetchAdminData" />
        </SettingsCard>
      </template>
      <SettingsUsersCard />
    </section>

    <!-- Dialogs（原內容不動） -->
    <SettingsNotificationRuleDialog
      :open="dialogOpen"
      :editing-rule="editingRule"
      @update:open="dialogOpen = $event"
      @saved="fetchSelfData"
    />

    <SettingsChangePasswordDialog v-model:open="changePwOpen" />

    <!-- Delete Confirmation -->
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
  </div>
</template>
