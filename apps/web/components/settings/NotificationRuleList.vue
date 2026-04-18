<script setup lang="ts">
import { Bell, Pencil, Plus, Trash2 } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import type { NotificationRule } from '~/types/settings'

defineProps<{
  rules: NotificationRule[]
  loading: boolean
}>()

const emit = defineEmits<{
  create: []
  edit: [rule: NotificationRule]
  delete: [rule: NotificationRule]
  refresh: []
}>()

const settingsApi = useSettingsApi()

function formatChannelLabel(channel: string): string {
  return channel === 'telegram' ? 'Telegram' : channel === 'calendar' ? 'Calendar' : channel
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
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center justify-between">
      <div>
        <h2 class="text-lg font-semibold flex items-center gap-2">
          <Bell class="h-5 w-5" />
          通知規則
        </h2>
        <p class="text-sm text-muted-foreground mt-0.5">設定帳單到期前的提醒方式與時間。</p>
      </div>
      <Button size="sm" @click="emit('create')">
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
        <Button class="mt-4" size="sm" @click="emit('create')"><Plus class="mr-2 h-4 w-4" />建立第一條規則</Button>
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
              <Button variant="ghost" size="icon" class="h-8 w-8" @click="emit('edit', rule)"><Pencil class="h-4 w-4" /><span class="sr-only">編輯</span></Button>
              <Button variant="ghost" size="icon" class="h-8 w-8 text-destructive hover:text-destructive" @click="emit('delete', rule)"><Trash2 class="h-4 w-4" /><span class="sr-only">刪除</span></Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  </div>
</template>
