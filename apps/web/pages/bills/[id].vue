<template>
  <div class="space-y-6 max-w-3xl">
    <!-- Back Button -->
    <Button variant="ghost" size="sm" class="-ml-2" @click="navigateTo('/bills')">
      <ArrowLeft class="h-4 w-4" />
      返回帳單列表
    </Button>

    <!-- Loading State -->
    <template v-if="loading">
      <Card class="animate-pulse">
        <CardHeader>
          <div class="h-6 w-40 rounded bg-muted" />
          <div class="h-4 w-56 rounded bg-muted mt-2" />
        </CardHeader>
        <CardContent class="space-y-4">
          <div class="h-8 w-36 rounded bg-muted" />
          <div class="h-4 w-full rounded bg-muted" />
          <div class="h-4 w-3/4 rounded bg-muted" />
        </CardContent>
      </Card>
    </template>

    <!-- Error State -->
    <Card v-else-if="error" class="py-12">
      <CardContent class="flex flex-col items-center text-center">
        <AlertTriangle class="h-12 w-12 text-destructive mb-4" />
        <h4 class="text-lg font-semibold mb-1">載入失敗</h4>
        <p class="text-sm text-muted-foreground mb-4">無法載入帳單資料</p>
        <Button variant="outline" @click="fetchBill">
          重試
        </Button>
      </CardContent>
    </Card>

    <!-- Bill Detail -->
    <template v-else-if="bill">
      <!-- Header Card -->
      <Card>
        <CardHeader>
          <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle class="text-xl">{{ bill.bankName }}</CardTitle>
            </div>
            <Badge :class="statusBadgeClass(bill.status)" class="self-start text-sm px-3 py-1">
              {{ statusLabel(bill.status) }}
            </Badge>
          </div>
        </CardHeader>
        <CardContent class="space-y-6">
          <!-- Amount Section -->
          <div class="space-y-3">
            <div>
              <Label class="text-muted-foreground text-xs uppercase tracking-wide">應繳金額</Label>
              <p class="text-3xl font-bold mt-1">{{ formatAmount(bill.amount) }}</p>
            </div>
            <div v-if="bill.minimumPayment != null">
              <Label class="text-muted-foreground text-xs uppercase tracking-wide">最低應繳</Label>
              <p class="text-lg font-semibold mt-1 text-muted-foreground">
                {{ formatAmount(bill.minimumPayment) }}
              </p>
            </div>
          </div>

          <Separator />

          <!-- Details Grid -->
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div class="space-y-1">
              <Label class="text-muted-foreground text-xs uppercase tracking-wide">繳費截止日</Label>
              <div class="flex items-center gap-2">
                <Calendar class="h-4 w-4 text-muted-foreground" />
                <span class="font-medium">{{ formatDate(bill.dueDate) }}</span>
                <span :class="daysRemainingInfo.className" class="text-sm font-medium">
                  ({{ daysRemainingInfo.text }})
                </span>
              </div>
            </div>

            <div v-if="bill.billingPeriodStart && bill.billingPeriodEnd" class="space-y-1">
              <Label class="text-muted-foreground text-xs uppercase tracking-wide">帳單週期</Label>
              <div class="flex items-center gap-2">
                <CalendarRange class="h-4 w-4 text-muted-foreground" />
                <span class="font-medium">
                  {{ formatDate(bill.billingPeriodStart) }} - {{ formatDate(bill.billingPeriodEnd) }}
                </span>
              </div>
            </div>

            <div v-if="bill.createdAt" class="space-y-1">
              <Label class="text-muted-foreground text-xs uppercase tracking-wide">建立時間</Label>
              <div class="flex items-center gap-2">
                <Clock class="h-4 w-4 text-muted-foreground" />
                <span class="font-medium">{{ formatDate(bill.createdAt) }}</span>
              </div>
            </div>
          </div>
        </CardContent>
        <CardFooter class="flex flex-col gap-2 sm:flex-row">
          <Button
            v-if="bill.status !== 'paid'"
            class="w-full sm:w-auto"
            :disabled="actionLoading"
            @click="handleMarkAsPaid"
          >
            <Loader2 v-if="actionLoading" class="h-4 w-4 animate-spin" />
            <CircleCheck v-else class="h-4 w-4" />
            {{ actionLoading ? '處理中...' : '標記已繳' }}
          </Button>
          <Button
            v-else
            variant="outline"
            class="w-full sm:w-auto"
            :disabled="actionLoading"
            @click="handleRevertToPending"
          >
            <Loader2 v-if="actionLoading" class="h-4 w-4 animate-spin" />
            <Undo2 v-else class="h-4 w-4" />
            {{ actionLoading ? '處理中...' : '恢復為待繳' }}
          </Button>
        </CardFooter>
      </Card>

      <!-- Raw Email Snippet -->
      <Card v-if="bill.rawEmailSnippet">
        <CardHeader
          class="cursor-pointer select-none"
          @click="emailExpanded = !emailExpanded"
        >
          <div class="flex items-center justify-between">
            <CardTitle class="text-base flex items-center gap-2">
              <Mail class="h-4 w-4" />
              原始郵件內容
            </CardTitle>
            <Button variant="ghost" size="icon-sm" :aria-label="emailExpanded ? '收合' : '展開'">
              <ChevronDown
                class="h-4 w-4 transition-transform duration-200"
                :class="{ 'rotate-180': emailExpanded }"
              />
            </Button>
          </div>
        </CardHeader>
        <template v-if="emailExpanded">
          <CardContent>
            <pre class="whitespace-pre-wrap text-sm text-muted-foreground bg-muted rounded-md p-4 overflow-x-auto max-h-96 overflow-y-auto font-mono leading-relaxed">{{ bill.rawEmailSnippet }}</pre>
          </CardContent>
        </template>
      </Card>

      <!-- Notification History -->
      <Card>
        <CardHeader>
          <CardTitle class="text-base flex items-center gap-2">
            <Bell class="h-4 w-4" />
            通知紀錄
          </CardTitle>
          <CardDescription>此帳單的提醒通知歷史</CardDescription>
        </CardHeader>
        <CardContent>
          <template v-if="notifications.length === 0">
            <div class="flex flex-col items-center py-8 text-center">
              <BellOff class="h-8 w-8 text-muted-foreground mb-3" />
              <p class="text-sm text-muted-foreground">尚無通知紀錄</p>
            </div>
          </template>
          <div v-else class="space-y-3">
            <div
              v-for="(notification, index) in notifications"
              :key="notification.id ?? index"
              class="flex items-start gap-3 rounded-lg border border-border p-3"
            >
              <div class="mt-0.5">
                <div
                  class="h-2 w-2 rounded-full"
                  :class="{
                    'bg-green-500': notification.status === 'sent',
                    'bg-red-500': notification.status === 'failed',
                    'bg-yellow-500': notification.status === 'pending',
                  }"
                />
              </div>
              <div class="flex-1 min-w-0 space-y-1">
                <div class="flex items-center justify-between gap-2">
                  <span class="text-sm font-medium truncate">{{ notification.channel }}</span>
                  <span class="text-xs text-muted-foreground whitespace-nowrap">
                    {{ formatDate(notification.sentAt) }}
                  </span>
                </div>
                <p v-if="notification.message" class="text-sm text-muted-foreground truncate">
                  {{ notification.message }}
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </template>
  </div>
</template>

<script setup lang="ts">
import { toast } from 'vue-sonner'
import {
  ArrowLeft,
  Calendar,
  CalendarRange,
  CreditCard,
  Clock,
  CircleCheck,
  AlertTriangle,
  Loader2,
  Undo2,
  Mail,
  ChevronDown,
  Bell,
  BellOff,
} from 'lucide-vue-next'

interface BillDetail {
  id: string
  bankName: string
  amount: number
  minimumPayment?: number
  dueDate: string
  status: 'pending' | 'paid' | 'overdue'
  billingPeriodStart?: string
  billingPeriodEnd?: string
  rawEmailSnippet?: string
  notifications?: Notification[]
  createdAt?: string
}

interface Notification {
  id?: string
  channel: string
  status: 'sent' | 'failed' | 'pending'
  sentAt: string
  message?: string
}

// --- Helpers ---

function formatAmount(amount: number): string {
  return `NT$ ${amount.toLocaleString('zh-TW')}`
}

function formatDate(date: string | Date): string {
  const d = new Date(date)
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`
}

function daysUntil(date: string | Date): number {
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  const target = new Date(date)
  target.setHours(0, 0, 0, 0)
  return Math.ceil((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
}

function statusLabel(status: string): string {
  const map: Record<string, string> = {
    pending: '待繳',
    paid: '已繳',
    overdue: '逾期',
  }
  return map[status] ?? status
}

function statusBadgeClass(status: string): string {
  const map: Record<string, string> = {
    pending: 'bg-yellow-500/15 text-yellow-500 border-yellow-500/25 hover:bg-yellow-500/15',
    paid: 'bg-green-500/15 text-green-500 border-green-500/25 hover:bg-green-500/15',
    overdue: 'bg-red-500/15 text-red-500 border-red-500/25 hover:bg-red-500/15',
  }
  return map[status] ?? ''
}

// --- Route & API ---

const route = useRoute()
const billId = computed(() => route.params.id as string)

const { getById, markAsPaid, update } = useBillApi()

const bill = ref<BillDetail | null>(null)
const loading = ref(true)
const error = ref(false)
const actionLoading = ref(false)
const emailExpanded = ref(false)

const notifications = computed<Notification[]>(() => bill.value?.notifications ?? [])

const daysRemainingInfo = computed(() => {
  if (!bill.value) return { text: '', className: '' }
  const days = daysUntil(bill.value.dueDate)
  if (days < 0) return { text: `已逾期 ${Math.abs(days)} 天`, className: 'text-red-500' }
  if (days === 0) return { text: '今天到期', className: 'text-red-500' }
  if (days <= 3) return { text: `剩 ${days} 天`, className: 'text-yellow-500' }
  return { text: `剩 ${days} 天`, className: 'text-muted-foreground' }
})

async function fetchBill() {
  loading.value = true
  error.value = false
  try {
    bill.value = await getById(billId.value)
  } catch {
    error.value = true
    toast.error('載入帳單失敗')
  } finally {
    loading.value = false
  }
}

async function handleMarkAsPaid() {
  actionLoading.value = true
  try {
    await markAsPaid(billId.value)
    toast.success('帳單已標記為已繳')
    await fetchBill()
  } catch {
    toast.error('操作失敗', { description: '無法標記帳單，請稍後再試' })
  } finally {
    actionLoading.value = false
  }
}

async function handleRevertToPending() {
  actionLoading.value = true
  try {
    await update(billId.value, { status: 'pending' })
    toast.success('帳單已恢復為待繳')
    await fetchBill()
  } catch {
    toast.error('操作失敗', { description: '無法恢復帳單狀態，請稍後再試' })
  } finally {
    actionLoading.value = false
  }
}

onMounted(() => fetchBill())

useHead({
  title: computed(() => bill.value ? `${bill.value.bankName} - Bill Alarm` : 'Bill Alarm'),
})
</script>
