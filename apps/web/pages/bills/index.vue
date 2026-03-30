<template>
  <div class="space-y-6">
    <!-- Page Header -->
    <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h2 class="text-2xl font-bold tracking-tight">帳單管理</h2>
        <p class="text-muted-foreground">查看與管理所有信用卡帳單</p>
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

    <!-- Status Tabs -->
    <Tabs v-model="activeTab" class="space-y-4">
      <TabsList>
        <TabsTrigger value="all">
          全部
          <Badge v-if="counts.all > 0" variant="secondary" class="ml-1.5">
            {{ counts.all }}
          </Badge>
        </TabsTrigger>
        <TabsTrigger value="pending">
          待繳
          <Badge v-if="counts.pending > 0" class="ml-1.5 bg-yellow-500/15 text-yellow-500 border-yellow-500/25 hover:bg-yellow-500/15">
            {{ counts.pending }}
          </Badge>
        </TabsTrigger>
        <TabsTrigger value="paid">
          已繳
          <Badge v-if="counts.paid > 0" class="ml-1.5 bg-green-500/15 text-green-500 border-green-500/25 hover:bg-green-500/15">
            {{ counts.paid }}
          </Badge>
        </TabsTrigger>
        <TabsTrigger value="overdue">
          逾期
          <Badge v-if="counts.overdue > 0" class="ml-1.5 bg-red-500/15 text-red-500 border-red-500/25 hover:bg-red-500/15">
            {{ counts.overdue }}
          </Badge>
        </TabsTrigger>
      </TabsList>

      <TabsContent value="all">
        <BillListContent :bills="filteredBills" :loading="loading" :marking-paid="markingPaid" @mark-paid="handleMarkAsPaid" />
      </TabsContent>
      <TabsContent value="pending">
        <BillListContent :bills="filteredBills" :loading="loading" :marking-paid="markingPaid" @mark-paid="handleMarkAsPaid" />
      </TabsContent>
      <TabsContent value="paid">
        <BillListContent :bills="filteredBills" :loading="loading" :marking-paid="markingPaid" @mark-paid="handleMarkAsPaid" />
      </TabsContent>
      <TabsContent value="overdue">
        <BillListContent :bills="filteredBills" :loading="loading" :marking-paid="markingPaid" @mark-paid="handleMarkAsPaid" />
      </TabsContent>
    </Tabs>
  </div>
</template>

<script setup lang="ts">
import { toast } from 'vue-sonner'
import {
  Calendar,
  CircleCheck,
  Loader2,
  Eye,
  Inbox,
} from 'lucide-vue-next'

interface Bill {
  id: string
  bankName: string
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

function daysRemainingText(dueDate: string): { text: string, className: string } {
  const days = daysUntil(dueDate)
  if (days < 0) {
    return { text: `已逾期 ${Math.abs(days)} 天`, className: 'text-red-500' }
  }
  if (days === 0) {
    return { text: '今天到期', className: 'text-red-500' }
  }
  if (days <= 3) {
    return { text: `剩 ${days} 天`, className: 'text-yellow-500' }
  }
  return { text: `剩 ${days} 天`, className: 'text-muted-foreground' }
}

// --- Month Filter ---

function getCurrentMonth(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

function generateMonthOptions(): Array<{ value: string, label: string }> {
  const options: Array<{ value: string, label: string }> = []
  const now = new Date()
  for (let i = -6; i <= 3; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1)
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const label = `${d.getFullYear()} 年 ${d.getMonth() + 1} 月`
    options.push({ value, label })
  }
  return options
}

const selectedMonth = ref<string>(getCurrentMonth())
const monthOptions = generateMonthOptions()

// --- Tab State ---

const activeTab = ref<string>('all')

// --- Data ---

const { list, markAsPaid } = useBillApi()

const allBills = ref<Bill[]>([])
const loading = ref(true)
const markingPaid = ref<Set<string>>(new Set())

const filteredBills = computed<Bill[]>(() => {
  if (activeTab.value === 'all') return allBills.value
  return allBills.value.filter(b => b.status === activeTab.value)
})

const counts = computed(() => {
  const bills = allBills.value
  return {
    all: bills.length,
    pending: bills.filter(b => b.status === 'pending').length,
    paid: bills.filter(b => b.status === 'paid').length,
    overdue: bills.filter(b => b.status === 'overdue').length,
  }
})

async function fetchBills() {
  loading.value = true
  try {
    allBills.value = await list({ month: selectedMonth.value })
  } catch {
    toast.error('載入帳單失敗', { description: '請稍後再試' })
  } finally {
    loading.value = false
  }
}

async function handleMarkAsPaid(id: string) {
  markingPaid.value.add(id)
  try {
    await markAsPaid(id)
    toast.success('帳單已標記為已繳')
    await fetchBills()
  } catch {
    toast.error('操作失敗', { description: '無法標記帳單，請稍後再試' })
  } finally {
    markingPaid.value.delete(id)
  }
}

watch(selectedMonth, () => fetchBills())

onMounted(() => fetchBills())

useHead({ title: '帳單管理 - Bill Alarm' })

// --- Inline child component for bill list rendering ---

const BillListContent = defineComponent({
  props: {
    bills: { type: Array as PropType<Bill[]>, required: true },
    loading: { type: Boolean, required: true },
    markingPaid: { type: Set as unknown as PropType<Set<string>>, required: true },
  },
  emits: ['mark-paid'],
  setup(props, { emit }) {
    return () => {
      // Loading skeleton
      if (props.loading) {
        return h('div', { class: 'space-y-3' }, Array.from({ length: 4 }, (_, i) =>
          h(resolveComponent('Card'), { key: i, class: 'animate-pulse' }, {
            default: () => h('div', { class: 'p-4 flex items-center gap-4' }, [
              h('div', { class: 'flex-1 space-y-2' }, [
                h('div', { class: 'h-4 w-32 rounded bg-muted' }),
                h('div', { class: 'h-3 w-48 rounded bg-muted' }),
              ]),
              h('div', { class: 'h-8 w-20 rounded bg-muted' }),
            ]),
          }),
        ))
      }

      // Empty state
      if (props.bills.length === 0) {
        return h(resolveComponent('Card'), { class: 'py-12' }, {
          default: () => h(resolveComponent('CardContent'), { class: 'flex flex-col items-center text-center' }, {
            default: () => [
              h(Inbox, { class: 'h-12 w-12 text-muted-foreground mb-4' }),
              h('h4', { class: 'text-lg font-semibold mb-1' }, '沒有帳單'),
              h('p', { class: 'text-sm text-muted-foreground' }, '此篩選條件下沒有帳單'),
            ],
          }),
        })
      }

      // Bill list
      return h('div', { class: 'space-y-3' }, props.bills.map(bill =>
        h(resolveComponent('Card'), {
          key: bill.id,
          class: 'transition-colors hover:border-primary/50 cursor-pointer',
          onClick: () => navigateTo(`/bills/${bill.id}`),
        }, {
          default: () => h('div', { class: 'p-4 flex flex-col gap-3 sm:flex-row sm:items-center' }, [
            // Bill info
            h('div', { class: 'flex-1 min-w-0 space-y-1' }, [
              h('div', { class: 'flex items-center gap-2 flex-wrap' }, [
                h('span', { class: 'font-semibold truncate' }, bill.bankName),
                h(resolveComponent('Badge'), { class: statusBadgeClass(bill.status) }, {
                  default: () => statusLabel(bill.status),
                }),
              ]),
              h('div', { class: 'flex items-center gap-3 text-sm text-muted-foreground' }, [
                h('span', { class: 'flex items-center gap-1' }, [
                  h(Calendar, { class: 'h-3.5 w-3.5' }),
                  formatDate(bill.dueDate),
                ]),
                (() => {
                  const remaining = daysRemainingText(bill.dueDate)
                  return h('span', { class: `text-xs font-medium ${remaining.className}` }, remaining.text)
                })(),
              ]),
            ]),
            // Amount and actions
            h('div', { class: 'flex items-center gap-3 sm:gap-4' }, [
              h('span', { class: 'text-lg font-bold whitespace-nowrap' }, formatAmount(bill.amount)),
              h('div', { class: 'flex items-center gap-1.5' }, [
                h(resolveComponent('Button'), {
                  variant: 'ghost',
                  size: 'icon-sm',
                  onClick: (e: Event) => { e.stopPropagation(); navigateTo(`/bills/${bill.id}`) },
                  'aria-label': '查看帳單詳情',
                }, {
                  default: () => h(Eye, { class: 'h-4 w-4' }),
                }),
                bill.status !== 'paid'
                  ? h(resolveComponent('Button'), {
                    size: 'sm',
                    disabled: props.markingPaid.has(bill.id),
                    onClick: (e: Event) => { e.stopPropagation(); emit('mark-paid', bill.id) },
                  }, {
                    default: () => [
                      props.markingPaid.has(bill.id)
                        ? h(Loader2, { class: 'h-4 w-4 animate-spin' })
                        : h(CircleCheck, { class: 'h-4 w-4' }),
                      props.markingPaid.has(bill.id) ? '處理中...' : '標記已繳',
                    ],
                  })
                  : null,
              ]),
            ]),
          ]),
        }),
      ))
    }
  },
})
</script>
