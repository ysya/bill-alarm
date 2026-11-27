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
            {{ scanTriggerLabel(scanProgress.trigger) }}中 {{ scanProgress.idx }}/{{ scanProgress.total }}
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
          {{ scanTriggerLabel(scanProgress.trigger) }}中
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

      <div
        v-if="activeTab === 'unpaid'"
        class="max-w-xs"
      >
        <Select
          :model-value="activeView"
          @update:model-value="setView"
        >
          <SelectTrigger aria-label="未繳帳單篩選">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem
              v-for="item in unpaidViews"
              :key="item.value"
              :value="item.value"
            >
              {{ item.label }}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div
        v-if="activeTab === 'paid' && activePeriod"
        class="flex items-center gap-3 text-sm"
      >
        <span>{{ formatPeriodLabel(activePeriod) }}</span>
        <Button
          variant="outline"
          size="sm"
          @click="router.replace({ query: { tab: 'paid' } })"
        >
          顯示所有帳期
        </Button>
      </div>

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

        <Card
          v-else-if="loadError"
          class="p-4"
        >
          <p>無法載入帳單。</p>
          <Button
            variant="outline"
            size="sm"
            @click="fetchBills"
          >
            重試
          </Button>
        </Card>

        <!-- Empty -->
        <Card
          v-else-if="bills.length === 0"
          class="py-12"
        >
          <CardContent class="flex flex-col items-center text-center">
            <Inbox class="h-12 w-12 text-muted-foreground mb-4" />
            <!-- 信箱引導只在「全部」tab（真的一筆帳單都沒有）出現；
                 其他 tab 空了不代表沒帳單，別誤導使用者去重設信箱。 -->
            <template v-if="!emailConfigured && activeTab === 'all'">
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
            <template v-else-if="activeTab === 'unpaid' && activeView === 'all'">
              <h4 class="text-lg font-semibold mb-1">
                沒有未繳帳單{{ emailConfigured ? ' 🎉' : '' }}
              </h4>
              <p class="text-sm text-muted-foreground">
                {{ emailConfigured ? '所有帳單都處理完了。' : '完成信箱授權後，新帳單會自動掃進來。' }}
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
                共 {{ group.bills.length }} 筆 · {{ activeView === 'funding' ? '尚需 ' : '' }}{{ formatAmount(group.total) }}
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
                    <NuxtLink
                      :to="`/bills/${bill.id}`"
                      class="truncate font-semibold hover:underline"
                      @click.stop
                    >{{ bill.bank?.name }}</NuxtLink>
                    <BillStatusBadge :bill="bill" />
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
                    <DaysRemaining
                      :bill="bill"
                      plain
                    />
                  </div>
                  <BillFundingNote :bill="bill" />
                </div>
                <div class="flex flex-wrap items-center gap-3 sm:gap-4">
                  <span class="text-lg font-bold whitespace-nowrap">{{ formatAmount(bill.amount) }}</span>
                  <BillPaymentActions
                    v-if="bill.status === BillStatus.PENDING || bill.status === BillStatus.OVERDUE"
                    :bill="bill"
                    :refresh="fetchBills"
                    compact
                  />
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
import { scanTriggerLabel } from '~/composables/useScanEvents'
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Inbox,
  RefreshCw,
} from 'lucide-vue-next'
import { BillStatus, fundingRemaining, isAwaitingDebit } from '@bill-alarm/shared/types'
import type { BillDTO } from '@bill-alarm/shared/types'
import { formatAmount } from '@bill-alarm/shared/format'
import { formatYMD } from '@bill-alarm/shared/date'

// --- Helpers ---

function formatPeriodLabel(period: string): string {
  const match = period.match(/^(\d{4})-(\d{2})$/)
  if (!match) return period || '未分類'
  return `${match[1]} 年 ${match[2]} 月帳單`
}

// --- State ---

const PAGE_SIZE = 20
const VALID_TABS = ['all', 'unpaid', 'paid', 'no_payment'] as const

const { list } = useBillApi()
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
const loading = ref(true)

const unpaidViews = [
  { value: 'all', label: '全部未繳' },
  { value: 'funding', label: '尚需繳款或備款' },
  { value: 'awaiting', label: '待確認扣繳' },
  { value: 'overdue', label: '逾期需處理' },
  { value: 'upcoming', label: '即將到期' },
]

const activeTab = computed({
  get: () => VALID_TABS.find(tab => tab === route.query.tab) ?? 'all',
  set: (tab: string) => { router.replace({ query: tab === 'all' ? {} : { tab } }) },
})
const activeView = computed(() => activeTab.value === 'unpaid'
  ? unpaidViews.find(item => item.value === route.query.view)?.value ?? 'all'
  : 'all')
const activePeriod = computed(() => {
  const period = route.query.period
  return activeTab.value === 'paid' && typeof period === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(period) ? period : ''
})
const currentPage = computed(() => {
  const page = Number(route.query.page)
  return Number.isSafeInteger(page) && page > 0 ? page : 1
})
function setView(view: unknown) {
  if (typeof view === 'string') router.replace({ query: { tab: 'unpaid', view: view === 'all' ? undefined : view } })
}
const loadError = ref(false)

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
    const overdue = bills.value.filter(b => b.status === BillStatus.OVERDUE && !isAwaitingDebit(b))
    const upcoming = bills.value.filter(b => b.status !== BillStatus.OVERDUE && !isAwaitingDebit(b))
    const awaitingDebit = bills.value.filter(isAwaitingDebit)
    const groups: BillGroup[] = []
    if (overdue.length > 0) {
      groups.push({
        key: 'overdue',
        label: `已逾期（${overdue.length}）`,
        labelClass: 'text-red-500',
        bills: overdue,
        total: overdue.reduce((s, b) => s + (activeView.value === 'funding' ? fundingRemaining(b) : b.amount), 0),
      })
    }
    if (upcoming.length > 0) {
      groups.push({
        key: 'upcoming',
        label: `即將到期（${upcoming.length}）`,
        labelClass: 'text-muted-foreground',
        bills: upcoming,
        total: upcoming.reduce((s, b) => s + (activeView.value === 'funding' ? fundingRemaining(b) : b.amount), 0),
      })
    }
    if (awaitingDebit.length > 0) {
      groups.push({
        key: 'awaiting-debit',
        label: `待確認扣繳（${awaitingDebit.length}）`,
        labelClass: 'text-muted-foreground',
        bills: awaitingDebit,
        total: awaitingDebit.reduce((sum, bill) => sum + bill.amount, 0),
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

let requestId = 0
async function fetchBills() {
  const id = ++requestId
  loading.value = true
  loadError.value = false
  try {
    const result = await list({
      status: activeTab.value === 'all' ? undefined : activeTab.value,
      view: activeView.value === 'all' ? undefined : activeView.value,
      billingPeriod: activePeriod.value || undefined,
      page: currentPage.value, pageSize: PAGE_SIZE,
    })
    if (id !== requestId) return
    bills.value = result.data
    total.value = result.total
    if (currentPage.value > totalPages.value) goToPage(totalPages.value)
  }
  catch {
    if (id === requestId) loadError.value = true
  }
  finally {
    if (id === requestId) loading.value = false
  }
}

function goToPage(page: number) {
  router.replace({ query: { ...route.query, page: page === 1 ? undefined : String(page) } })
}

watch([activeTab, activeView, activePeriod, currentPage], fetchBills)

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
