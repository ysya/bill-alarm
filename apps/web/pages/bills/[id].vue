<template>
  <div class="space-y-6" :class="bill?.pdfPath ? 'max-w-7xl' : 'max-w-3xl'">
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
      <!-- 2-column layout when PDF exists: narrow info panel + wide PDF -->
      <div :class="bill.pdfPath ? 'grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-4' : ''">
        <!-- Left: Bill info + actions -->
        <Card>
          <CardHeader>
            <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div class="space-y-1">
                <CardTitle class="text-xl">{{ bill.bank?.name }}</CardTitle>
                <div class="flex flex-wrap gap-2 items-center">
                  <Badge :class="statusBadgeClass(bill.status)" class="text-xs px-2 py-0.5">
                    {{ statusLabel(bill.status) }}
                  </Badge>
                  <span v-if="bill.parseSource" class="inline-flex items-center gap-1 text-xs" :class="parseSourceClass(bill.parseSource)">
                    <span>{{ parseSourceIcon(bill.parseSource) }}</span>
                    {{ parseSourceLabel(bill.parseSource) }}
                  </span>
                </div>
              </div>
              <div class="flex gap-1">
                <Button
                  v-if="!editing"
                  size="sm"
                  variant="outline"
                  @click="startEdit"
                >
                  <Pencil class="h-3.5 w-3.5" />
                  編輯
                </Button>
                <template v-else>
                  <Button size="sm" variant="outline" :disabled="actionLoading" @click="cancelEdit">
                    取消
                  </Button>
                  <Button size="sm" :disabled="actionLoading" @click="handleSaveEdit">
                    <Loader2 v-if="actionLoading" class="h-3.5 w-3.5 animate-spin" />
                    <Save v-else class="h-3.5 w-3.5" />
                    儲存
                  </Button>
                </template>
              </div>
            </div>

            <div v-if="bill.parseSource === 'llm'" class="mt-2 rounded-md bg-orange-500/10 border border-orange-500/30 p-2 text-xs">
              <Sparkles class="inline h-3.5 w-3.5 mr-1 text-orange-500" />
              此帳單由 AI 解析，數值可能有誤，建議核對 PDF 後使用編輯功能調整。
            </div>
          </CardHeader>

          <CardContent class="space-y-5">
            <!-- Hero: Amount -->
            <div>
              <Label class="text-muted-foreground text-xs uppercase tracking-wide">應繳金額</Label>
              <p v-if="!editing" class="text-4xl font-bold leading-none mt-1">
                {{ formatAmount(bill.amount) }}
              </p>
              <Input v-else v-model.number="editForm.amount" type="number" class="text-2xl font-bold h-12 mt-1" />
              <p
                v-if="!editing && bill.minimumPayment != null && bill.minimumPayment > 0"
                class="text-sm text-muted-foreground mt-2"
              >
                最低應繳 {{ formatAmount(bill.minimumPayment) }}
              </p>
              <Input
                v-if="editing"
                v-model.number="editForm.minimumPayment"
                type="number"
                placeholder="最低應繳 (選填)"
                class="mt-2"
              />
            </div>

            <Separator />

            <!-- Paid info (if paid) -->
            <div v-if="bill.status === BillStatus.PAID && bill.paidAt" class="rounded-md bg-green-500/10 border border-green-500/30 p-3">
              <Label class="text-xs text-green-700 dark:text-green-400 uppercase tracking-wide">繳費時間</Label>
              <div class="flex items-center gap-2 mt-1">
                <CircleCheck class="h-4 w-4 text-green-500" />
                <span class="font-medium">{{ formatDate(bill.paidAt) }}</span>
              </div>
            </div>

            <!-- Dates (stacked, 1-column to fit narrow panel) -->
            <div class="space-y-4">
              <div>
                <Label class="text-muted-foreground text-xs uppercase tracking-wide">繳費截止日</Label>
                <div v-if="!editing" class="flex items-center gap-2 mt-1 flex-wrap">
                  <CalendarIcon class="h-4 w-4 text-muted-foreground shrink-0" />
                  <span class="font-medium whitespace-nowrap">{{ formatDate(bill.dueDate) }}</span>
                  <span
                    v-if="daysRemainingInfo.text"
                    :class="daysRemainingInfo.className"
                    class="text-xs font-medium whitespace-nowrap"
                  >
                    {{ daysRemainingInfo.text }}
                  </span>
                </div>
                <Input v-else v-model="editForm.dueDate" type="date" class="mt-1" />
              </div>

              <div v-if="bill.billingPeriod">
                <Label class="text-muted-foreground text-xs uppercase tracking-wide">帳單週期</Label>
                <div class="flex items-center gap-2 mt-1">
                  <CalendarRange class="h-4 w-4 text-muted-foreground shrink-0" />
                  <span class="font-medium">{{ bill.billingPeriod }}</span>
                </div>
              </div>

              <div v-if="bill.createdAt">
                <Label class="text-muted-foreground text-xs uppercase tracking-wide">建立時間</Label>
                <div class="flex items-center gap-2 mt-1">
                  <Clock class="h-4 w-4 text-muted-foreground shrink-0" />
                  <span class="text-sm text-muted-foreground whitespace-nowrap">{{ formatDate(bill.createdAt) }}</span>
                </div>
              </div>
            </div>
          </CardContent>

          <CardFooter class="flex flex-col gap-2 sm:flex-row flex-wrap">
            <Button
              v-if="bill.status !== BillStatus.PAID"
              :disabled="actionLoading || editing"
              @click="payDialogOpen = true; payDate = today(getLocalTimeZone())"
            >
              <CircleCheck class="h-4 w-4" />
              標記已繳
            </Button>
            <Button
              v-else
              variant="outline"
              :disabled="actionLoading || editing"
              @click="handleRevertToPending"
            >
              <Loader2 v-if="actionLoading" class="h-4 w-4 animate-spin" />
              <Undo2 v-else class="h-4 w-4" />
              恢復為待繳
            </Button>
            <Button
              v-if="bill.pdfPath"
              variant="outline"
              :disabled="actionLoading || reparsing || editing"
              @click="handleReparse"
            >
              <Loader2 v-if="reparsing" class="h-4 w-4 animate-spin" />
              <Sparkles v-else class="h-4 w-4" />
              {{ reparsing ? 'AI 解析中...' : 'AI 重新解析' }}
            </Button>
            <Button
              variant="outline"
              class="sm:ml-auto text-destructive hover:text-destructive"
              :disabled="actionLoading || editing"
              @click="deleteDialogOpen = true"
            >
              <Trash2 class="h-4 w-4" />
              刪除
            </Button>
          </CardFooter>
        </Card>

        <!-- Right: PDF inline preview -->
        <Card v-if="bill.pdfPath" class="lg:sticky lg:top-4 lg:self-start">
          <CardHeader>
            <div class="flex items-center justify-between">
              <CardTitle class="text-base flex items-center gap-2">
                <FileText class="h-4 w-4" />
                原始 PDF
              </CardTitle>
              <Button
                size="sm"
                variant="ghost"
                as="a"
                :href="`/api/bills/${bill.id}/pdf`"
                target="_blank"
              >
                <ExternalLink class="h-3.5 w-3.5" />
                開新分頁
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <iframe
              :src="`/api/bills/${bill.id}/pdf#pagemode=none&view=FitH`"
              class="w-full h-[70vh] rounded border"
              title="PDF preview"
            />
          </CardContent>
        </Card>
      </div>

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
                    'bg-green-500': notification.success,
                    'bg-red-500': !notification.success,
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

    <!-- Mark as Paid Dialog -->
    <Dialog v-model:open="payDialogOpen">
      <DialogContent class="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>標記為已繳</DialogTitle>
          <DialogDescription>選擇繳費日期，預設為今天。</DialogDescription>
        </DialogHeader>
        <div class="flex justify-center py-2">
          <Calendar v-model="payDate" />
        </div>
        <DialogFooter class="gap-2">
          <DialogClose as-child><Button variant="outline">取消</Button></DialogClose>
          <Button :disabled="actionLoading" @click="handleConfirmPaid">
            <Loader2 v-if="actionLoading" class="mr-2 h-4 w-4 animate-spin" />
            確認已繳
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- Delete Confirm Dialog -->
    <Dialog v-model:open="deleteDialogOpen">
      <DialogContent class="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>確認刪除</DialogTitle>
          <DialogDescription>確定要刪除此帳單嗎？此操作無法復原。</DialogDescription>
        </DialogHeader>
        <DialogFooter class="gap-2">
          <DialogClose as-child><Button variant="outline">取消</Button></DialogClose>
          <Button variant="destructive" :disabled="actionLoading" @click="handleDelete">確認刪除</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>

<script setup lang="ts">
import { toast } from 'vue-sonner'
import {
  ArrowLeft,
  Calendar as CalendarIcon,
  CalendarRange,
  Clock,
  FileText,
  CircleCheck,
  AlertTriangle,
  Loader2,
  Undo2,
  Mail,
  ChevronDown,
  Bell,
  BellOff,
  Trash2,
  Pencil,
  Save,
  Sparkles,
  ExternalLink,
} from 'lucide-vue-next'
import { getLocalTimeZone, today } from '@internationalized/date'
import type { DateValue } from 'reka-ui'
import { BillStatus, statusLabel, statusBadgeClass } from '@bill-alarm/shared/types'
import type { BillDetailDTO, NotificationDTO } from '@bill-alarm/shared/types'

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

// --- Route & API ---

const route = useRoute()
const billId = computed(() => route.params.id as string)

const { getById, markAsPaid, update, reparse, remove } = useBillApi()

const bill = ref<BillDetailDTO | null>(null)
const loading = ref(true)
const error = ref(false)
const actionLoading = ref(false)
const reparsing = ref(false)
const emailExpanded = ref(false)
const deleteDialogOpen = ref(false)
const payDialogOpen = ref(false)
const payDate = ref(today(getLocalTimeZone())) as Ref<DateValue>

// Edit mode
const editing = ref(false)
const editForm = ref<{
  amount: number
  minimumPayment: number | null
  dueDate: string
}>({
  amount: 0,
  minimumPayment: null,
  dueDate: '',
})

function startEdit() {
  if (!bill.value) return
  editForm.value = {
    amount: bill.value.amount,
    minimumPayment: bill.value.minimumPayment ?? null,
    dueDate: new Date(bill.value.dueDate).toISOString().split('T')[0],
  }
  editing.value = true
}

function cancelEdit() {
  editing.value = false
}

async function handleSaveEdit() {
  if (!bill.value) return
  actionLoading.value = true
  try {
    const payload: Record<string, unknown> = {
      amount: Math.round(editForm.value.amount),
      dueDate: new Date(editForm.value.dueDate + 'T00:00:00').toISOString(),
    }
    // Only send minimumPayment if user entered a positive value
    if (editForm.value.minimumPayment && editForm.value.minimumPayment > 0) {
      payload.minimumPayment = Math.round(editForm.value.minimumPayment)
    } else {
      payload.minimumPayment = null
    }
    await update(bill.value.id, payload)
    toast.success('帳單已更新')
    editing.value = false
    await fetchBill()
  } catch (e: any) {
    toast.error('儲存失敗', { description: e?.data?.error ?? String(e) })
  } finally {
    actionLoading.value = false
  }
}

async function handleReparse() {
  if (!bill.value) return
  reparsing.value = true
  try {
    await reparse(bill.value.id)
    toast.success('AI 重新解析完成，請核對結果')
    await fetchBill()
  } catch (e: any) {
    toast.error('AI 解析失敗', { description: e?.data?.error ?? String(e) })
  } finally {
    reparsing.value = false
  }
}

function parseSourceLabel(src: string | null | undefined): string {
  if (src === 'llm') return 'AI 解析'
  if (src === 'template') return '自訂規則'
  if (src === 'hardcoded') return '內建規則'
  if (src === 'generic') return '通用規則'
  return '未知'
}

function parseSourceIcon(src: string | null | undefined): string {
  if (src === 'llm') return '🤖'
  if (src === 'template' || src === 'hardcoded') return '✓'
  if (src === 'generic') return '⚠'
  return ''
}

function parseSourceClass(src: string | null | undefined): string {
  if (src === 'llm') return 'text-orange-600 dark:text-orange-400'
  if (src === 'template' || src === 'hardcoded') return 'text-green-600 dark:text-green-400'
  if (src === 'generic') return 'text-yellow-600 dark:text-yellow-400'
  return 'text-muted-foreground'
}

const notifications = computed<NotificationDTO[]>(() => bill.value?.notifications ?? [])

const daysRemainingInfo = computed(() => {
  if (!bill.value) return { text: '', className: '' }
  if (bill.value.status === BillStatus.PAID) return { text: '', className: '' }
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

async function handleConfirmPaid() {
  actionLoading.value = true
  try {
    await markAsPaid(billId.value, payDate.value.toString())
    toast.success('帳單已標記為已繳')
    payDialogOpen.value = false
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
    await update(billId.value, { status: BillStatus.PENDING })
    toast.success('帳單已恢復為待繳')
    await fetchBill()
  } catch {
    toast.error('操作失敗', { description: '無法恢復帳單狀態，請稍後再試' })
  } finally {
    actionLoading.value = false
  }
}

async function handleDelete() {
  actionLoading.value = true
  try {
    await remove(billId.value)
    toast.success('帳單已刪除')
    navigateTo('/bills')
  } catch {
    toast.error('刪除失敗')
  } finally {
    actionLoading.value = false
    deleteDialogOpen.value = false
  }
}

onMounted(() => fetchBill())

useHead({
  title: computed(() => bill.value ? `${bill.value.bank?.name} - Bill Alarm` : 'Bill Alarm'),
})
</script>
