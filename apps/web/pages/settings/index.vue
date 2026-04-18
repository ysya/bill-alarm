<script setup lang="ts">
import { toast } from 'vue-sonner'
import type { NotificationRule, OAuthStatus } from '~/types/settings'

const settingsApi = useSettingsApi()

const rules = ref<NotificationRule[]>([])
const oauthStatus = ref<OAuthStatus | null>(null)
const loading = ref(true)

// Rule dialog state
const dialogOpen = ref(false)
const editingRule = ref<NotificationRule | null>(null)
const deleteDialogOpen = ref(false)
const deletingRule = ref<NotificationRule | null>(null)
const submitting = ref(false)

const activeTab = ref('integrations')

async function fetchData() {
  loading.value = true
  try {
    const [ruleList, , oauth] = await Promise.all([
      settingsApi.listRules(),
      settingsApi.getIntegrationStatus(),
      settingsApi.getOAuthStatus(),
    ])
    rules.value = ruleList
    oauthStatus.value = oauth
  } catch (error) {
    toast.error('載入設定失敗', { description: String(error) })
  } finally {
    loading.value = false
  }
}

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
    await fetchData()
  } catch (error) {
    toast.error('刪除失敗', { description: String(error) })
  } finally {
    submitting.value = false
  }
}

onMounted(fetchData)
</script>

<template>
  <div class="space-y-6">
    <!-- Page Header -->
    <div>
      <h1 class="text-2xl font-bold tracking-tight">設定</h1>
      <p class="text-sm text-muted-foreground mt-1">管理通知規則與第三方服務整合。</p>
    </div>

    <!-- Tabs -->
    <Tabs v-model="activeTab" class="space-y-6">
      <TabsList>
        <TabsTrigger value="integrations">服務整合</TabsTrigger>
        <TabsTrigger value="notifications">通知規則</TabsTrigger>
      </TabsList>

      <!-- Tab: Integrations -->
      <TabsContent value="integrations" class="space-y-6">
        <!-- Loading -->
        <div v-if="loading" class="space-y-6">
          <div v-for="i in 3" :key="i" class="animate-pulse space-y-3">
            <div class="h-5 w-32 bg-muted rounded" />
            <div class="h-10 w-full bg-muted rounded" />
          </div>
        </div>

        <template v-else-if="oauthStatus">
          <SettingsIntegrationGoogle
            :google="oauthStatus.google"
            :calendar="oauthStatus.calendar"
            :scan="oauthStatus.scan"
            @refresh="fetchData"
          />
          <Separator />
          <SettingsIntegrationTelegram
            :status="oauthStatus.telegram"
            @refresh="fetchData"
          />
          <Separator />
          <SettingsIntegrationLLM
            :llm="oauthStatus.llm"
            :gemini="oauthStatus.gemini"
            @refresh="fetchData"
          />
        </template>
      </TabsContent>

      <!-- Tab: Notification Rules -->
      <TabsContent value="notifications">
        <SettingsNotificationRuleList
          :rules="rules"
          :loading="loading"
          @create="openCreateDialog"
          @edit="openEditDialog"
          @delete="openDeleteDialog"
          @refresh="fetchData"
        />
      </TabsContent>
    </Tabs>

    <!-- Dialogs -->
    <SettingsNotificationRuleDialog
      :open="dialogOpen"
      :editing-rule="editingRule"
      @update:open="dialogOpen = $event"
      @saved="fetchData"
    />

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
