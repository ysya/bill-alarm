<template>
  <div class="space-y-6">
    <!-- Page Header -->
    <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h2 class="text-2xl font-bold tracking-tight">總覽</h2>
        <p class="text-muted-foreground">信用卡帳單繳費狀態一覽</p>
      </div>
      <div class="w-full sm:w-auto">
        <Select v-model="selectedMonth">
          <SelectTrigger class="w-full sm:w-44">
            <SelectValue placeholder="選擇月份" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem
              v-for="month in monthOptions"
              :key="month.value"
              :value="month.value"
            >
              {{ month.label }}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>

    <!-- Summary Cards -->
    <div class="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
      <Card>
        <CardHeader class="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle class="text-sm font-medium">待繳總金額</CardTitle>
          <DollarSign class="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div class="text-2xl font-bold">
            {{ formatAmount(summary?.totalPendingAmount ?? 0) }}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader class="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle class="text-sm font-medium">待繳帳單</CardTitle>
          <Clock class="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div class="text-2xl font-bold">
            {{ summary?.pendingCount ?? 0 }}
          </div>
          <p class="text-xs text-muted-foreground">筆帳單待繳</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader class="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle class="text-sm font-medium">本月已繳</CardTitle>
          <CircleCheck class="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div class="text-2xl font-bold">
            {{ summary?.paidCount ?? 0 }}
          </div>
          <p class="text-xs text-muted-foreground">筆帳單已繳清</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader class="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle class="text-sm font-medium">逾期帳單</CardTitle>
          <AlertTriangle class="h-4 w-4 text-destructive" />
        </CardHeader>
        <CardContent>
          <div class="text-2xl font-bold" :class="{ 'text-destructive': (summary?.overdueCount ?? 0) > 0 }">
            {{ summary?.overdueCount ?? 0 }}
          </div>
          <p class="text-xs text-muted-foreground">筆帳單已逾期</p>
        </CardContent>
      </Card>
    </div>

    <!-- Pending Bills List -->
    <div class="space-y-4">
      <div class="flex items-center justify-between">
        <h3 class="text-lg font-semibold">待繳帳單</h3>
        <NuxtLink to="/bills">
          <Button variant="ghost" size="sm">
            查看全部
            <ArrowRight class="ml-1 h-4 w-4" />
          </Button>
        </NuxtLink>
      </div>

      <!-- Loading State -->
      <div v-if="loading" class="grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
        <Card v-for="n in 3" :key="n" class="animate-pulse">
          <CardHeader>
            <div class="h-4 w-24 rounded bg-muted" />
            <div class="h-3 w-32 rounded bg-muted" />
          </CardHeader>
          <CardContent>
            <div class="h-6 w-28 rounded bg-muted" />
          </CardContent>
        </Card>
      </div>

      <!-- Empty State -->
      <Card v-else-if="pendingBills.length === 0" class="flex flex-col items-center justify-center py-12">
        <CardContent class="flex flex-col items-center text-center">
          <CircleCheck class="h-12 w-12 text-muted-foreground mb-4" />
          <h4 class="text-lg font-semibold mb-1">沒有待繳帳單</h4>
          <p class="text-sm text-muted-foreground">
            本月所有帳單皆已繳清，做得好！
          </p>
        </CardContent>
      </Card>

      <!-- Bill Cards -->
      <div v-else class="grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
        <Card
          v-for="bill in pendingBills"
          :key="bill.id"
          class="transition-colors hover:border-primary/50 cursor-pointer"
          @click="navigateTo(`/bills/${bill.id}`)"
        >
          <CardHeader class="pb-3">
            <div class="flex items-start justify-between">
              <div>
                <CardTitle class="text-base">{{ bill.bank?.name }}</CardTitle>
              </div>
              <Badge :class="statusBadgeClass(bill.status)">
                {{ statusLabel(bill.status) }}
              </Badge>
            </div>
          </CardHeader>
          <CardContent class="space-y-3">
            <div class="text-2xl font-bold">
              {{ formatAmount(bill.amount) }}
            </div>
            <Separator />
            <div class="flex items-center justify-between text-sm">
              <div class="flex items-center gap-1.5 text-muted-foreground">
                <Calendar class="h-3.5 w-3.5" />
                <span>截止日 {{ formatDate(bill.dueDate) }}</span>
              </div>
              <DaysRemainingBadge :due-date="bill.dueDate" />
            </div>
          </CardContent>
          <CardFooter class="pt-0">
            <Button
              class="w-full"
              size="sm"
              :disabled="markingPaid.has(bill.id)"
              @click.stop="handleMarkAsPaid(bill.id)"
            >
              <Loader2 v-if="markingPaid.has(bill.id)" class="h-4 w-4 animate-spin" />
              <CircleCheck v-else class="h-4 w-4" />
              {{ markingPaid.has(bill.id) ? '處理中...' : '標記已繳' }}
            </Button>
          </CardFooter>
        </Card>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { toast } from 'vue-sonner'
import {
  DollarSign,
  Clock,
  CircleCheck,
  AlertTriangle,
  ArrowRight,
  Calendar,
  Loader2,
} from 'lucide-vue-next'

interface BillSummary {
  totalPendingAmount: number
  pendingCount: number
  paidCount: number
  overdueCount: number
}

interface Bill {
  id: string
  bank?: { name: string }
  amount: number
  dueDate: string
  status: 'pending' | 'paid' | 'overdue'
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

// --- Month Filter ---

function getCurrentMonth(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

function generateMonthOptions(): Array<{ value: string, label: string }> {
  const options: Array<{ value: string, label: string }> = []
  const now = new Date()
  for (let i = -3; i <= 3; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1)
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const label = `${d.getFullYear()} 年 ${d.getMonth() + 1} 月`
    options.push({ value, label })
  }
  return options
}

const selectedMonth = ref<string>(getCurrentMonth())
const monthOptions = generateMonthOptions()

// --- DaysRemainingBadge (inline render function) ---

const DaysRemainingBadge = defineComponent({
  props: {
    dueDate: { type: String, required: true },
  },
  setup(props) {
    return () => {
      const days = daysUntil(props.dueDate)
      let text: string
      let className: string

      if (days < 0) {
        text = `已逾期 ${Math.abs(days)} 天`
        className = 'text-red-500 bg-red-500/10'
      } else if (days === 0) {
        text = '今天到期'
        className = 'text-red-500 bg-red-500/10'
      } else if (days <= 3) {
        text = `剩 ${days} 天`
        className = 'text-yellow-500 bg-yellow-500/10'
      } else {
        text = `剩 ${days} 天`
        className = 'text-muted-foreground bg-muted'
      }

      return h('span', {
        class: `inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${className}`,
      }, text)
    }
  },
})

// --- Data Fetching ---

const { getSummary, list, markAsPaid } = useBillApi()

const summary = ref<BillSummary | null>(null)
const pendingBills = ref<Bill[]>([])
const loading = ref(true)
const markingPaid = ref<Set<string>>(new Set())

async function fetchData() {
  loading.value = true
  try {
    const [summaryData, billsData] = await Promise.all([
      getSummary({ month: selectedMonth.value }),
      list({ month: selectedMonth.value, status: 'pending' }),
    ])
    summary.value = summaryData
    pendingBills.value = billsData
  } catch {
    toast.error('載入資料失敗', { description: '請稍後再試' })
  } finally {
    loading.value = false
  }
}

async function handleMarkAsPaid(id: string) {
  markingPaid.value.add(id)
  try {
    await markAsPaid(id)
    toast.success('帳單已標記為已繳')
    await fetchData()
  } catch {
    toast.error('操作失敗', { description: '無法標記帳單，請稍後再試' })
  } finally {
    markingPaid.value.delete(id)
  }
}

watch(selectedMonth, () => fetchData())

onMounted(() => fetchData())

useHead({ title: '總覽 - Bill Alarm' })
</script>
