<template>
  <div class="space-y-6">
    <!-- Page Header -->
    <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div class="flex items-center gap-3">
        <h2 class="text-2xl font-bold tracking-tight">帳單管理</h2>
        <Button variant="outline" size="sm" :disabled="scanning" @click="handleScan">
          <RefreshCw class="mr-2 h-4 w-4" :class="scanning ? 'animate-spin' : ''" />
          {{ scanning ? '掃描中...' : '掃描信件' }}
        </Button>
      </div>
    </div>

    <!-- Status Tabs -->
    <Tabs v-model="activeTab" class="space-y-4">
      <TabsList>
        <TabsTrigger value="all">
          全部
          <Badge v-if="total > 0" variant="secondary" class="ml-1.5">{{ total }}</Badge>
        </TabsTrigger>
        <TabsTrigger value="pending">
          待繳
        </TabsTrigger>
        <TabsTrigger value="paid">
          已繳
        </TabsTrigger>
        <TabsTrigger value="overdue">
          逾期
        </TabsTrigger>
      </TabsList>

      <!-- Shared content for all tabs -->
      <TabsContent :value="activeTab" :force-mount="true">
        <!-- Loading -->
        <div v-if="loading" class="space-y-3">
          <Card v-for="i in 4" :key="i" class="animate-pulse">
            <div class="p-4 flex items-center gap-4">
              <div class="flex-1 space-y-2">
                <div class="h-4 w-32 rounded bg-muted" />
                <div class="h-3 w-48 rounded bg-muted" />
              </div>
              <div class="h-8 w-20 rounded bg-muted" />
            </div>
          </Card>
        </div>

        <!-- Empty -->
        <Card v-else-if="bills.length === 0" class="py-12">
          <CardContent class="flex flex-col items-center text-center">
            <Inbox class="h-12 w-12 text-muted-foreground mb-4" />
            <h4 class="text-lg font-semibold mb-1">沒有帳單</h4>
            <p class="text-sm text-muted-foreground">目前沒有符合條件的帳單</p>
          </CardContent>
        </Card>

        <!-- Bill list -->
        <div v-else class="space-y-3">
          <Card
            v-for="bill in bills"
            :key="bill.id"
            class="transition-colors hover:border-primary/50 cursor-pointer"
            @click="navigateTo(`/bills/${bill.id}`)"
          >
            <div class="p-4 flex flex-col gap-3 sm:flex-row sm:items-center">
              <div class="flex-1 min-w-0 space-y-1">
                <div class="flex items-center gap-2 flex-wrap">
                  <span class="font-semibold truncate">{{ bill.bank?.name }}</span>
                  <Badge :class="statusBadgeClass(bill.status)">{{ statusLabel(bill.status) }}</Badge>
                  <span class="text-xs text-muted-foreground">{{ bill.billingPeriod }}</span>
                </div>
                <div class="flex items-center gap-3 text-sm text-muted-foreground">
                  <span class="flex items-center gap-1">
                    <CalendarIcon class="h-3.5 w-3.5" />
                    {{ formatDate(bill.dueDate) }}
                  </span>
                  <span v-if="bill.status !== BillStatus.PAID" :class="`text-xs font-medium ${daysRemainingText(bill.dueDate).className}`">
                    {{ daysRemainingText(bill.dueDate).text }}
                  </span>
                </div>
              </div>
              <div class="flex items-center gap-3 sm:gap-4">
                <span class="text-lg font-bold whitespace-nowrap">{{ formatAmount(bill.amount) }}</span>
                <Button
                  v-if="bill.status !== BillStatus.PAID"
                  size="sm"
                  :disabled="markingPaid.has(bill.id)"
                  @click.stop="openPayDialog(bill.id)"
                >
                  <Loader2 v-if="markingPaid.has(bill.id)" class="h-4 w-4 animate-spin" />
                  <CircleCheck v-else class="h-4 w-4" />
                  {{ markingPaid.has(bill.id) ? '處理中...' : '標記已繳' }}
                </Button>
              </div>
            </div>
          </Card>
        </div>

        <!-- Pagination -->
        <div v-if="totalPages > 1" class="flex items-center justify-between pt-4">
          <p class="text-sm text-muted-foreground">
            共 {{ total }} 筆，第 {{ currentPage }} / {{ totalPages }} 頁
          </p>
          <div class="flex items-center gap-2">
            <Button variant="outline" size="sm" :disabled="currentPage <= 1" @click="goToPage(currentPage - 1)">
              <ChevronLeft class="h-4 w-4" />
              上一頁
            </Button>
            <Button variant="outline" size="sm" :disabled="currentPage >= totalPages" @click="goToPage(currentPage + 1)">
              下一頁
              <ChevronRight class="h-4 w-4" />
            </Button>
          </div>
        </div>
      </TabsContent>
    </Tabs>

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
          <Button :disabled="markingPaid.size > 0" @click="handleConfirmPaid">
            <Loader2 v-if="markingPaid.size > 0" class="mr-2 h-4 w-4 animate-spin" />
            確認已繳
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>

<script setup lang="ts">
import { toast } from 'vue-sonner'
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  Loader2,
  Inbox,
  RefreshCw,
} from 'lucide-vue-next'
import { getLocalTimeZone, today } from '@internationalized/date'
import type { DateValue } from 'reka-ui'
import { BillStatus, statusLabel, statusBadgeClass } from '@bill-alarm/shared/types'
import type { BillDTO } from '@bill-alarm/shared/types'

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

function daysRemainingText(dueDate: string): { text: string; className: string } {
  const days = daysUntil(dueDate)
  if (days < 0) return { text: `已逾期 ${Math.abs(days)} 天`, className: 'text-red-500' }
  if (days === 0) return { text: '今天到期', className: 'text-red-500' }
  if (days <= 3) return { text: `剩 ${days} 天`, className: 'text-yellow-500' }
  return { text: `剩 ${days} 天`, className: 'text-muted-foreground' }
}

// --- State ---

const PAGE_SIZE = 20

const { list, markAsPaid } = useBillApi()
const { post } = useApi()

const bills = ref<BillDTO[]>([])
const total = ref(0)
const currentPage = ref(1)
const loading = ref(true)
const scanning = ref(false)
const markingPaid = ref<Set<string>>(new Set())
const activeTab = ref<string>('all')

// Mark as paid dialog
const payDialogOpen = ref(false)
const payingBillId = ref<string | null>(null)
const payDate = ref(today(getLocalTimeZone())) as Ref<DateValue>

function openPayDialog(id: string) {
  payingBillId.value = id
  payDate.value = today(getLocalTimeZone())
  payDialogOpen.value = true
}

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / PAGE_SIZE)))

// --- Data ---

async function fetchBills() {
  loading.value = true
  try {
    const status = activeTab.value === 'all' ? undefined : activeTab.value
    const result = await list({ status, page: currentPage.value, pageSize: PAGE_SIZE })
    bills.value = result.data
    total.value = result.total
  } catch {
    toast.error('載入帳單失敗', { description: '請稍後再試' })
  } finally {
    loading.value = false
  }
}

function goToPage(page: number) {
  currentPage.value = page
}

async function handleConfirmPaid() {
  if (!payingBillId.value) return
  const id = payingBillId.value
  markingPaid.value.add(id)
  try {
    await markAsPaid(id, payDate.value.toString())
    toast.success('帳單已標記為已繳')
    payDialogOpen.value = false
    await fetchBills()
  } catch {
    toast.error('操作失敗', { description: '無法標記帳單，請稍後再試' })
  } finally {
    markingPaid.value.delete(id)
  }
}

async function handleScan() {
  scanning.value = true
  try {
    const result = await post<{ scanned: number; newBills: number; errors: string[] }>('/gmail/scan')
    if (result.newBills > 0) {
      toast.success(`掃描完成，新增 ${result.newBills} 筆帳單`)
      await fetchBills()
    } else if (result.scanned === 0) {
      toast.warning('沒有找到任何信件', { description: '請確認 Gmail 已連線，或信箱中沒有新的帳單通知' })
    } else {
      toast.info(`已檢查 ${result.scanned} 封信件，沒有新帳單`)
    }
    if (result.errors.length > 0) {
      toast.warning('部分信件處理失敗', { description: result.errors.join('\n') })
    }
  } catch {
    toast.error('掃描失敗', { description: '請確認 Gmail 已連線' })
  } finally {
    scanning.value = false
  }
}

// 切換 tab 時回到第一頁
watch(activeTab, () => {
  currentPage.value = 1
  fetchBills()
})

watch(currentPage, () => fetchBills())

onMounted(() => fetchBills())

useHead({ title: '帳單管理 - Bill Alarm' })
</script>
