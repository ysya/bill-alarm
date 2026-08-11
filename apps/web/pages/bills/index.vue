<template>
  <div class="space-y-6">
    <!-- Page Header -->
    <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div class="flex items-center gap-3">
        <h2 class="text-2xl font-bold tracking-tight">
          帳單管理
        </h2>
        <Button
          variant="outline"
          size="sm"
          :disabled="scanInProgress"
          @click="triggerScan(fetchBills)"
        >
          <RefreshCw
            class="mr-2 h-4 w-4"
            :class="scanInProgress ? 'animate-spin' : ''"
          />
          <template v-if="scanProgress.active">
            掃描中 {{ scanProgress.idx }}/{{ scanProgress.total }}
            <span
              v-if="scanProgress.bank"
              class="ml-1 text-muted-foreground"
            >
              · {{ scanProgress.bank }}
            </span>
          </template>
          <template v-else-if="scanning">
            啟動中...
          </template>
          <template v-else>
            掃描信件
          </template>
        </Button>
      </div>
    </div>

    <!-- Live scan progress -->
    <div
      v-if="scanProgress.active"
      class="space-y-1.5 rounded-lg border border-border bg-muted/20 p-3"
    >
      <div class="flex items-center justify-between text-xs">
        <span class="font-medium">
          {{ scanProgress.trigger === 'cron' ? '自動掃描中' : '手動掃描中' }}
          · {{ scanProgress.idx }} / {{ scanProgress.total }}
        </span>
        <span class="text-muted-foreground">{{ progressPercent }}%</span>
      </div>
      <div class="h-1.5 w-full overflow-hidden rounded-full bg-border">
        <div
          class="h-full bg-primary transition-all duration-200"
          :style="{ width: `${progressPercent}%` }"
        />
      </div>
      <p
        v-if="scanProgress.bank || scanProgress.lastReason"
        class="truncate text-xs text-muted-foreground"
      >
        <span
          v-if="scanProgress.bank"
          class="font-medium"
        >{{ scanProgress.bank }}</span>
        <span
          v-if="scanProgress.lastReason"
          class="ml-1"
        >— {{ scanProgress.lastReason }}</span>
      </p>
    </div>

    <!-- Status Tabs -->
    <Tabs
      v-model="activeTab"
      class="space-y-4"
    >
      <TabsList>
        <TabsTrigger value="all">
          全部
        </TabsTrigger>
        <TabsTrigger value="unpaid">
          未繳
        </TabsTrigger>
        <TabsTrigger value="paid">
          已繳
        </TabsTrigger>
        <TabsTrigger value="no_payment">
          免繳
        </TabsTrigger>
      </TabsList>

      <!-- Shared content for all tabs -->
      <TabsContent
        :value="activeTab"
        :force-mount="true"
      >
        <!-- Loading -->
        <div
          v-if="loading"
          class="space-y-3"
        >
          <Card
            v-for="i in 4"
            :key="i"
            class="animate-pulse"
          >
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
        <Card
          v-else-if="bills.length === 0"
          class="py-12"
        >
          <CardContent class="flex flex-col items-center text-center">
            <Inbox class="h-12 w-12 text-muted-foreground mb-4" />
            <template v-if="!emailConfigured">
              <h4 class="text-lg font-semibold mb-1">
                還沒有帳單
              </h4>
              <p class="text-sm text-muted-foreground">
                先到<NuxtLink
                  to="/settings#data-source"
                  class="underline underline-offset-4"
                >設定</NuxtLink>完成信箱授權，帳單會自動掃進來。
              </p>
            </template>
            <template v-else-if="activeTab === 'unpaid'">
              <h4 class="text-lg font-semibold mb-1">
                沒有未繳帳單 🎉
              </h4>
              <p class="text-sm text-muted-foreground">
                所有帳單都處理完了。
              </p>
            </template>
            <template v-else-if="activeTab === 'no_payment'">
              <h4 class="text-lg font-semibold mb-1">
                沒有免繳帳單
              </h4>
              <p class="text-sm text-muted-foreground">
                免繳＝本期無需繳款的帳單（如零元帳單）。
              </p>
            </template>
            <template v-else>
              <h4 class="text-lg font-semibold mb-1">
                沒有帳單
              </h4>
              <p class="text-sm text-muted-foreground">
                目前沒有符合條件的帳單
              </p>
            </template>
          </CardContent>
        </Card>

        <!-- Bill list (unpaid: overdue/upcoming sections; others: by period) -->
        <div
          v-else
          class="space-y-6"
        >
          <section
            v-for="group in groupedBills"
            :key="group.key"
            class="space-y-3"
          >
            <div class="flex items-center gap-3">
              <h3
                class="text-sm font-semibold"
                :class="group.labelClass"
              >
                {{ group.label }}
              </h3>
              <Separator class="flex-1" />
              <span class="text-xs text-muted-foreground whitespace-nowrap">
                共 {{ group.bills.length }} 筆 · {{ formatAmount(group.total) }}
              </span>
            </div>
            <Card
              v-for="bill in group.bills"
              :key="bill.id"
              class="transition-colors hover:border-primary/50 cursor-pointer"
              @click="navigateTo(`/bills/${bill.id}`)"
            >
              <div class="p-4 flex flex-col gap-3 sm:flex-row sm:items-center">
                <div class="flex-1 min-w-0 space-y-1">
                  <div class="flex items-center gap-2 flex-wrap">
                    <span class="font-semibold truncate">{{ bill.bank?.name }}</span>
                    <Badge :class="statusBadgeClass(bill.status)">
                      {{ statusLabel(bill.status) }}
                    </Badge>
                    <Badge
                      v-if="bill.bank?.autoDebit"
                      variant="secondary"
                      class="text-xs"
                    >
                      自動扣款
                    </Badge>
                  </div>
                  <div class="flex items-center gap-3 text-sm text-muted-foreground">
                    <span class="flex items-center gap-1">
                      <CalendarIcon class="h-3.5 w-3.5" />
                      {{ formatYMD(bill.dueDate) }}
                    </span>
                    <span
                      v-if="bill.status === BillStatus.PENDING || bill.status === BillStatus.OVERDUE"
                      :class="`text-xs font-medium ${daysRemainingText(bill.dueDate).className}`"
                    >
                      {{ daysRemainingText(bill.dueDate).text }}
                    </span>
                  </div>
                </div>
                <div class="flex items-center gap-3 sm:gap-4">
                  <span class="text-lg font-bold whitespace-nowrap">{{ formatAmount(bill.amount) }}</span>
                  <Button
                    v-if="bill.status === BillStatus.PENDING || bill.status === BillStatus.OVERDUE"
                    size="sm"
                    :disabled="markingIds.has(bill.id)"
                    :aria-label="`標記 ${bill.bank?.name} 已繳`"
                    @click.stop="markPaid(bill, fetchBills)"
                  >
                    <Loader2
                      v-if="markingIds.has(bill.id)"
                      class="h-4 w-4 animate-spin"
                    />
                    <CircleCheck
                      v-else
                      class="h-4 w-4"
                    />
                    {{ bill.bank?.autoDebit ? '確認已扣款' : '已繳' }}
                  </Button>
                </div>
              </div>
            </Card>
          </section>

          <p class="text-xs text-muted-foreground">
            找不到某張帳單？<NuxtLink
              to="/scan-logs"
              class="underline underline-offset-4"
            >查看掃描紀錄</NuxtLink>
          </p>
        </div>

        <!-- Pagination -->
        <div
          v-if="totalPages > 1"
          class="flex items-center justify-between pt-4"
        >
          <p class="text-sm text-muted-foreground">
            共 {{ total }} 筆，第 {{ currentPage }} / {{ totalPages }} 頁
          </p>
          <div class="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              :disabled="currentPage <= 1"
              @click="goToPage(currentPage - 1)"
            >
              <ChevronLeft class="h-4 w-4" />
              上一頁
            </Button>
            <Button
              variant="outline"
              size="sm"
              :disabled="currentPage >= totalPages"
              @click="goToPage(currentPage + 1)"
            >
              下一頁
              <ChevronRight class="h-4 w-4" />
            </Button>
          </div>
        </div>
      </TabsContent>
    </Tabs>
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
import { BillStatus, statusLabel, statusBadgeClass } from '@bill-alarm/shared/types'
import type { BillDTO } from '@bill-alarm/shared/types'
import { daysRemainingInfo, formatAmount, type DaysRemainingTone } from '@bill-alarm/shared/format'
import { formatYMD } from '@bill-alarm/shared/date'

// --- Helpers ---

// bills/index and bills/[id] render days-remaining as plain colored text (no
// badge pill), unlike <DaysRemaining>'s bg-tinted badge — so the tone->class
// map here intentionally omits the bg-* classes to keep the existing look.
const DAYS_REMAINING_TEXT_CLASS: Record<DaysRemainingTone, string> = {
  overdue: 'text-red-500',
  today: 'text-red-500',
  soon: 'text-yellow-500',
  normal: 'text-muted-foreground',
}

function daysRemainingText(dueDate: string): { text: string, className: string } {
  const { text, tone } = daysRemainingInfo(dueDate)
  return { text, className: DAYS_REMAINING_TEXT_CLASS[tone] }
}

function formatPeriodLabel(period: string): string {
  const match = period.match(/^(\d{4})-(\d{2})$/)
  if (!match) return period || '未分類'
  return `${match[1]} 年 ${match[2]} 月帳單`
}

// --- State ---

const PAGE_SIZE = 20
const VALID_TABS = ['all', 'unpaid', 'paid', 'no_payment'] as const

const { list } = useBillApi()
const { markingIds, markPaid } = useMarkPaid()
const { scanning, triggerScan } = useScanTrigger()

const route = useRoute()
const router = useRouter()

const { state: scanProgress, onComplete: onScanComplete } = useScanEvents()
onScanComplete.value = () => {
  fetchBills()
}
const scanInProgress = computed(() => scanning.value || scanProgress.value.active)
const progressPercent = computed(() =>
  scanProgress.value.total > 0
    ? Math.round((scanProgress.value.idx / scanProgress.value.total) * 100)
    : 0,
)

const bills = ref<BillDTO[]>([])
const total = ref(0)
const currentPage = ref(1)
const loading = ref(true)

// ?tab= deep link（非法值落回 all）
const initialTab = VALID_TABS.includes(route.query.tab as typeof VALID_TABS[number])
  ? route.query.tab as string
  : 'all'
const activeTab = ref<string>(initialTab)

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / PAGE_SIZE)))

interface BillGroup {
  key: string
  label: string
  labelClass: string
  bills: BillDTO[]
  total: number
}

const groupedBills = computed<BillGroup[]>(() => {
  if (activeTab.value === 'unpaid') {
    // 行動視圖：先還債、再排即將到期
    const overdue = bills.value.filter(b => b.status === BillStatus.OVERDUE)
    const upcoming = bills.value.filter(b => b.status !== BillStatus.OVERDUE)
    const groups: BillGroup[] = []
    if (overdue.length > 0) {
      groups.push({
        key: 'overdue',
        label: `已逾期（${overdue.length}）`,
        labelClass: 'text-red-500',
        bills: overdue,
        total: overdue.reduce((s, b) => s + b.amount, 0),
      })
    }
    if (upcoming.length > 0) {
      groups.push({
        key: 'upcoming',
        label: `即將到期（${upcoming.length}）`,
        labelClass: 'text-muted-foreground',
        bills: upcoming,
        total: upcoming.reduce((s, b) => s + b.amount, 0),
      })
    }
    return groups
  }

  // 帳簿視圖：依帳期分組（伺服器已按帳期降冪排序）
  const groups: BillGroup[] = []
  let current: BillGroup | null = null
  for (const bill of bills.value) {
    const period = bill.billingPeriod ?? ''
    if (!current || current.key !== period) {
      current = {
        key: period,
        label: formatPeriodLabel(period),
        labelClass: 'text-muted-foreground',
        bills: [],
        total: 0,
      }
      groups.push(current)
    }
    current.bills.push(bill)
    current.total += bill.amount
  }
  return groups
})

// --- Data ---

async function fetchBills() {
  loading.value = true
  try {
    const status = activeTab.value === 'all' ? undefined : activeTab.value
    const result = await list({ status, page: currentPage.value, pageSize: PAGE_SIZE })
    bills.value = result.data
    total.value = result.total
  }
  catch {
    toast.error('載入帳單失敗', { description: '請稍後再試' })
  }
  finally {
    loading.value = false
  }
}

function goToPage(page: number) {
  currentPage.value = page
}

// 切換 tab：回第一頁、寫回 URL（replace，不進 history）
watch(activeTab, (tab) => {
  currentPage.value = 1
  router.replace({ query: { ...route.query, tab: tab === 'all' ? undefined : tab } })
  fetchBills()
})

watch(currentPage, () => fetchBills())

const emailConfigured = ref(true) // 防閃：抓到狀態前先當 true
onMounted(async () => {
  fetchBills()
  try {
    emailConfigured.value = (await useSettingsApi().getOnboardingStatus()).emailConfigured
  }
  catch {
    // leave true — empty-state guidance is a nicety
  }
})

useHead({ title: '帳單管理 - Bill Alarm' })
</script>
