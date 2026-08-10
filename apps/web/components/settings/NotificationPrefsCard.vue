<script setup lang="ts">
import { AlertTriangle, Bell, CheckCircle, Plus, X, XCircle } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { Card, CardContent } from '@/components/ui/card'
import type { NotificationPrefsDTO } from '~/types/settings'

const props = defineProps<{
  prefs: NotificationPrefsDTO
  botConfigured: boolean
  telegramBound: boolean
  isAdmin: boolean
}>()

const emit = defineEmits<{ refresh: [] }>()

const settingsApi = useSettingsApi()

const QUICK_DAYS = [7, 3, 1]
const MAX_DAYS = 6
const SAVE_DEBOUNCE_MS = 800

const form = ref({
  remindDays: [...props.prefs.remindDays],
  remindTime: props.prefs.remindTime,
  notifyNewBill: props.prefs.notifyNewBill,
  notifyOverdue: props.prefs.notifyOverdue,
})
const customDay = ref<number | null>(null)

// Props → local copy must not trigger a save; only user edits do.
let applyingProps = false
watch(() => props.prefs, (p) => {
  applyingProps = true
  form.value = {
    remindDays: [...p.remindDays],
    remindTime: p.remindTime,
    notifyNewBill: p.notifyNewBill,
    notifyOverdue: p.notifyOverdue,
  }
  nextTick(() => {
    applyingProps = false
  })
})

let saveTimer: ReturnType<typeof setTimeout> | null = null
watch(form, () => {
  if (applyingProps) return
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(save, SAVE_DEBOUNCE_MS)
}, { deep: true })

onUnmounted(() => {
  if (saveTimer) clearTimeout(saveTimer)
})

async function save() {
  try {
    await settingsApi.updateNotificationPrefs({
      remindDays: form.value.remindDays,
      remindTime: form.value.remindTime,
      notifyNewBill: form.value.notifyNewBill,
      notifyOverdue: form.value.notifyOverdue,
    })
    toast.success('通知設定已更新')
  }
  catch (e) {
    toast.error('儲存失敗', { description: String(e) })
    emit('refresh') // re-sync local state with what the server actually has
  }
}

const sortedDays = computed(() => [...form.value.remindDays].sort((a, b) => b - a))
const quickAddCandidates = computed(() => QUICK_DAYS.filter(d => !form.value.remindDays.includes(d)))
const canAddMore = computed(() => form.value.remindDays.length < MAX_DAYS)

function addDay(d: number) {
  if (!canAddMore.value || form.value.remindDays.includes(d)) return
  form.value.remindDays = [...form.value.remindDays, d].sort((a, b) => b - a)
}

function addCustomDay() {
  const d = customDay.value
  if (d === null || !Number.isInteger(d) || d < 0 || d > 30) {
    toast.error('請輸入 0–30 的整數天數')
    return
  }
  addDay(d)
  customDay.value = null
}

function removeDay(d: number) {
  form.value.remindDays = form.value.remindDays.filter(x => x !== d)
}

const lastDeliveryText = computed(() => {
  const l = props.prefs.lastDelivery
  if (!l) return null
  const when = new Date(l.sentAt).toLocaleString('zh-TW', {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
  return { ...l, when }
})
</script>

<template>
  <div class="space-y-4">
    <div>
      <h2 class="text-lg font-semibold flex items-center gap-2">
        <Bell class="h-5 w-5" />
        通知設定
      </h2>
      <p class="text-sm text-muted-foreground mt-0.5">
        改動會自動儲存。提醒透過 Telegram 發送。
      </p>
    </div>

    <Card>
      <CardContent class="space-y-5 p-4">
        <!-- 送達狀態列：靜默失敗浮出 -->
        <div
          v-if="lastDeliveryText"
          class="flex items-center gap-2 rounded-lg border p-2.5 text-xs"
          :class="lastDeliveryText.success
            ? 'border-border bg-muted/30 text-muted-foreground'
            : 'border-destructive/40 bg-destructive/10 text-destructive'"
        >
          <CheckCircle
            v-if="lastDeliveryText.success"
            class="h-4 w-4 shrink-0 text-green-500"
          />
          <XCircle
            v-else
            class="h-4 w-4 shrink-0"
          />
          <span v-if="lastDeliveryText.success">上次發送：{{ lastDeliveryText.when }} ・{{ lastDeliveryText.message }}</span>
          <span v-else>上次發送失敗（{{ lastDeliveryText.when }}）：{{ lastDeliveryText.errorMessage || lastDeliveryText.message }}</span>
        </div>
        <p
          v-else
          class="text-xs text-muted-foreground"
        >
          尚未發送過任何通知。
        </p>

        <!-- 送達前置條件警示 -->
        <div
          v-if="!botConfigured"
          class="flex items-start gap-2 rounded-lg border border-yellow-500/40 bg-yellow-500/10 p-2.5 text-xs text-yellow-600 dark:text-yellow-500"
        >
          <AlertTriangle class="mt-0.5 h-4 w-4 shrink-0" />
          <span v-if="isAdmin">
            尚未設定 Telegram Bot，通知無法送達。到
            <a
              href="#system"
              class="underline font-medium"
            >系統管理</a> 填入 Bot Token。
          </span>
          <span v-else>管理員尚未設定 Telegram Bot，通知暫時無法送達，請聯絡管理員。</span>
        </div>
        <div
          v-else-if="!telegramBound"
          class="flex items-start gap-2 rounded-lg border border-yellow-500/40 bg-yellow-500/10 p-2.5 text-xs text-yellow-600 dark:text-yellow-500"
        >
          <AlertTriangle class="mt-0.5 h-4 w-4 shrink-0" />
          <span>尚未綁定 Telegram，通知不會送達——在下方「送達方式」完成綁定。</span>
        </div>

        <!-- 到期提醒天數 -->
        <div class="space-y-2">
          <Label>到期提醒</Label>
          <div class="flex flex-wrap items-center gap-2">
            <Badge
              v-for="d in sortedDays"
              :key="d"
              variant="outline"
              class="gap-1 py-1 pl-2.5 pr-1 text-sm"
            >
              前 {{ d }} 天
              <button
                type="button"
                class="rounded-full p-0.5 hover:bg-accent"
                :aria-label="`移除前 ${d} 天`"
                @click="removeDay(d)"
              >
                <X class="h-3 w-3" />
              </button>
            </Badge>
            <span
              v-if="sortedDays.length === 0"
              class="text-xs text-muted-foreground"
            >
              未設定到期提醒——加入天數後才會在到期前收到訊息。
            </span>
          </div>
          <div
            v-if="canAddMore"
            class="flex flex-wrap items-center gap-2"
          >
            <Button
              v-for="d in quickAddCandidates"
              :key="d"
              type="button"
              size="sm"
              variant="outline"
              class="h-7 px-2 text-xs"
              @click="addDay(d)"
            >
              <Plus class="mr-1 h-3 w-3" />前 {{ d }} 天
            </Button>
            <div class="flex items-center gap-1">
              <Input
                v-model.number="customDay"
                type="number"
                min="0"
                max="30"
                placeholder="自訂"
                class="h-7 w-20 text-xs"
                @keyup.enter="addCustomDay"
              />
              <Button
                type="button"
                size="sm"
                variant="ghost"
                class="h-7 px-2 text-xs"
                @click="addCustomDay"
              >
                加入
              </Button>
            </div>
          </div>
        </div>

        <!-- 提醒時間 -->
        <div class="space-y-2">
          <Label for="remindTime">提醒時間</Label>
          <Input
            id="remindTime"
            v-model="form.remindTime"
            type="time"
            class="w-32"
          />
          <p class="text-xs text-muted-foreground">
            每天這個時間檢查並發送到期提醒。
          </p>
        </div>

        <!-- 其他通知開關 -->
        <div class="space-y-2">
          <div class="flex items-center justify-between rounded-lg border border-border p-3">
            <div class="space-y-0.5">
              <Label
                for="notifyNewBill"
                class="cursor-pointer"
              >掃到新帳單時通知我</Label>
              <p class="text-xs text-muted-foreground">
                郵件掃描發現新帳單時立即發送。
              </p>
            </div>
            <Switch
              id="notifyNewBill"
              :model-value="form.notifyNewBill"
              @update:model-value="form.notifyNewBill = $event"
            />
          </div>
          <div class="flex items-center justify-between rounded-lg border border-border p-3">
            <div class="space-y-0.5">
              <Label
                for="notifyOverdue"
                class="cursor-pointer"
              >帳單逾期時警告我</Label>
              <p class="text-xs text-muted-foreground">
                過了截止日仍未繳清，早上 9 點發送一次警告。
              </p>
            </div>
            <Switch
              id="notifyOverdue"
              :model-value="form.notifyOverdue"
              @update:model-value="form.notifyOverdue = $event"
            />
          </div>
        </div>
      </CardContent>
    </Card>
  </div>
</template>
