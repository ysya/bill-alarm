<script setup lang="ts">
import { toast } from 'vue-sonner'
import type { NotificationRule } from '~/types/settings'
import { CHANNEL_OPTIONS } from '~/types/settings'

const props = defineProps<{
  open: boolean
  editingRule: NotificationRule | null
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  saved: []
}>()

const settingsApi = useSettingsApi()
const submitting = ref(false)

const defaultForm = {
  name: '',
  daysBefore: 3,
  timeOfDay: '09:00',
  channels: [] as string[],
  isActive: true,
}
const form = ref({ ...defaultForm })

const dialogTitle = computed(() => props.editingRule ? '編輯通知規則' : '新增通知規則')
const dialogDescription = computed(() =>
  props.editingRule
    ? '修改通知規則的觸發條件與通知頻道。'
    : '建立新的通知規則，在帳單到期前提醒你繳費。',
)

watch(() => props.editingRule, (rule) => {
  if (rule) {
    form.value = {
      name: rule.name,
      daysBefore: rule.daysBefore,
      timeOfDay: rule.timeOfDay,
      channels: [...rule.channels],
      isActive: rule.isActive,
    }
  } else {
    form.value = { ...defaultForm, channels: [] }
  }
})

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
    if (props.editingRule) {
      await settingsApi.updateRule(props.editingRule.id, payload)
      toast.success('通知規則已更新')
    } else {
      await settingsApi.createRule(payload)
      toast.success('通知規則已新增')
    }
    emit('update:open', false)
    emit('saved')
  } catch (error) {
    toast.error('操作失敗', { description: String(error) })
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
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
</template>
