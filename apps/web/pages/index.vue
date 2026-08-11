<template>
  <div class="space-y-6">
    <InstallPrompt variant="banner" />
    <OnboardingProgressCard />

    <!-- Page Header -->
    <div>
      <h2 class="text-2xl font-bold tracking-tight">
        總覽
      </h2>
      <p class="text-muted-foreground">
        信用卡帳單繳費狀態一覽
      </p>
    </div>

    <!-- Summary Cards（可點，跳帳單頁對應篩選） -->
    <div class="grid gap-4 grid-cols-1 sm:grid-cols-3">
      <NuxtLink to="/bills?tab=unpaid">
        <Card class="h-full transition-colors hover:border-primary/50">
          <CardHeader class="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle class="text-sm font-medium">
              目前待繳
            </CardTitle>
            <div class="flex items-center gap-1 text-muted-foreground">
              <DollarSign class="h-4 w-4" />
              <ChevronRight class="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent>
            <div class="text-2xl font-bold">
              {{ formatAmount(summary?.totalPending ?? 0) }}
            </div>
            <p class="text-xs text-muted-foreground">
              {{ summary?.pendingCount ?? 0 }} 筆{{ (summary?.overdueCount ?? 0) > 0 ? `，含 ${summary?.overdueCount} 筆逾期` : '' }}
            </p>
          </CardContent>
        </Card>
      </NuxtLink>

      <NuxtLink to="/bills?tab=paid">
        <Card class="h-full transition-colors hover:border-primary/50">
          <CardHeader class="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle class="text-sm font-medium">
              本月已繳
            </CardTitle>
            <div class="flex items-center gap-1 text-muted-foreground">
              <CircleCheck class="h-4 w-4" />
              <ChevronRight class="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent>
            <div class="text-2xl font-bold">
              {{ summary?.paidCount ?? 0 }}
            </div>
            <p class="text-xs text-muted-foreground">
              筆帳單已繳清
            </p>
          </CardContent>
        </Card>
      </NuxtLink>

      <NuxtLink to="/bills?tab=unpaid">
        <Card class="h-full transition-colors hover:border-primary/50">
          <CardHeader class="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle class="text-sm font-medium">
              逾期帳單
            </CardTitle>
            <div class="flex items-center gap-1 text-muted-foreground">
              <AlertTriangle
                class="h-4 w-4"
                :class="{ 'text-destructive': (summary?.overdueCount ?? 0) > 0 }"
              />
              <ChevronRight class="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent>
            <div
              class="text-2xl font-bold"
              :class="{ 'text-destructive': (summary?.overdueCount ?? 0) > 0 }"
            >
              {{ summary?.overdueCount ?? 0 }}
            </div>
            <p class="text-xs text-muted-foreground">
              筆帳單已逾期
            </p>
          </CardContent>
        </Card>
      </NuxtLink>
    </div>

    <!-- 接下來要繳（單一待辦流） -->
    <div class="space-y-4">
      <h3 class="text-lg font-semibold">
        接下來要繳
      </h3>

      <!-- Loading -->
      <div
        v-if="loading"
        class="space-y-2"
      >
        <Card
          v-for="n in 3"
          :key="n"
          class="animate-pulse"
        >
          <CardContent class="flex items-center justify-between p-4">
            <div class="h-4 w-32 rounded bg-muted" />
            <div class="h-6 w-24 rounded bg-muted" />
          </CardContent>
        </Card>
      </div>

      <!-- 未授權信箱：中性引導，不慶祝 -->
      <Card
        v-else-if="!emailConfigured && unpaidBills.length === 0"
        class="py-8"
      >
        <CardContent class="text-center text-sm text-muted-foreground">
          完成上方設定後，帳單會自動出現在這裡。
        </CardContent>
      </Card>

      <!-- 真正零未繳 -->
      <Card
        v-else-if="unpaidBills.length === 0"
        class="flex flex-col items-center justify-center py-10"
      >
        <CardContent class="flex flex-col items-center text-center">
          <CircleCheck class="h-12 w-12 text-muted-foreground mb-3" />
          <h4 class="text-lg font-semibold mb-1">
            目前沒有未繳帳單 🎉
          </h4>
          <p class="text-sm text-muted-foreground">
            所有帳單都處理完了。
          </p>
        </CardContent>
      </Card>

      <template v-else>
        <!-- 已逾期 -->
        <section
          v-if="overdueBills.length > 0"
          class="space-y-2"
        >
          <div class="flex items-center gap-3">
            <h4 class="text-sm font-semibold text-red-500">
              已逾期（{{ overdueBills.length }}）
            </h4>
            <Separator class="flex-1" />
          </div>
          <DashboardBillRow
            v-for="bill in overdueBills"
            :key="bill.id"
            :bill="bill"
            :marking="markingIds.has(bill.id)"
            @pay="markPaid(bill, fetchData)"
          />
        </section>

        <!-- 即將到期 -->
        <section
          v-if="upcomingShown.length > 0"
          class="space-y-2"
        >
          <div class="flex items-center gap-3">
            <h4 class="text-sm font-semibold text-muted-foreground">
              即將到期（{{ upcomingAll.length }}）
            </h4>
            <Separator class="flex-1" />
          </div>
          <DashboardBillRow
            v-for="bill in upcomingShown"
            :key="bill.id"
            :bill="bill"
            :marking="markingIds.has(bill.id)"
            @pay="markPaid(bill, fetchData)"
          />
          <div
            v-if="upcomingHiddenCount > 0"
            class="pt-1"
          >
            <NuxtLink
              to="/bills?tab=unpaid"
              class="text-sm text-muted-foreground underline-offset-4 hover:underline"
            >
              查看另外 {{ upcomingHiddenCount }} 筆未繳 →
            </NuxtLink>
          </div>
        </section>
      </template>

      <p class="text-xs text-muted-foreground">
        找不到某張帳單？<NuxtLink
          to="/scan-logs"
          class="underline underline-offset-4"
        >查看掃描紀錄</NuxtLink>
      </p>
    </div>

    <!-- 月度明細（月份選擇器只作用於此區） -->
    <div class="space-y-4">
      <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h3 class="text-lg font-semibold">
          {{ monthTitle }}明細
        </h3>
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
      <Card v-if="summary?.breakdown?.length">
        <CardContent class="p-0">
          <div class="divide-y">
            <div
              v-for="item in summary.breakdown"
              :key="item.bankId"
              class="flex items-center justify-between px-4 py-3"
            >
              <div class="flex items-center gap-2">
                <span class="font-medium text-sm">{{ item.bankName }}</span>
                <Badge
                  v-if="item.autoDebit"
                  variant="secondary"
                  class="text-xs"
                >
                  自動扣款
                </Badge>
              </div>
              <div class="text-right">
                <span class="font-bold">{{ formatAmount(item.totalAmount) }}</span>
                <span class="text-xs text-muted-foreground ml-2">{{ item.billCount }} 筆</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
      <p
        v-else
        class="text-sm text-muted-foreground"
      >
        這個月沒有帳單。
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { toast } from 'vue-sonner'
import {
  DollarSign,
  CircleCheck,
  AlertTriangle,
  ChevronRight,
} from 'lucide-vue-next'
import { BillStatus } from '@bill-alarm/shared/types'
import type { BillDTO, MonthlySummaryDTO } from '@bill-alarm/shared/types'
import { formatAmount } from '@bill-alarm/shared/format'

// --- Month Filter（只作用於月度明細區） ---

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

const monthTitle = computed(() => {
  const match = selectedMonth.value.match(/^(\d{4})-(\d{2})$/)
  return match ? `${match[1]} 年 ${Number(match[2])} 月` : ''
})

// --- Data ---

const { getSummary, list } = useBillApi()
const { markingIds, markPaid } = useMarkPaid()

const summary = ref<MonthlySummaryDTO | null>(null)
const unpaidBills = ref<BillDTO[]>([])
const loading = ref(true)

const UPCOMING_LIMIT = 5

const overdueBills = computed(() => unpaidBills.value.filter(b => b.status === BillStatus.OVERDUE))
const upcomingAll = computed(() => unpaidBills.value.filter(b => b.status !== BillStatus.OVERDUE))
const upcomingShown = computed(() => upcomingAll.value.slice(0, UPCOMING_LIMIT))
const upcomingHiddenCount = computed(() => Math.max(0, upcomingAll.value.length - UPCOMING_LIMIT))

async function fetchData() {
  loading.value = true
  try {
    const [summaryData, unpaidData] = await Promise.all([
      getSummary(selectedMonth.value),
      list({ status: 'unpaid', pageSize: 100 }),
    ])
    summary.value = summaryData
    unpaidBills.value = unpaidData.data
  }
  catch {
    toast.error('載入資料失敗', { description: '請稍後再試' })
  }
  finally {
    loading.value = false
  }
}

// 月份切換只需要新的 breakdown——未繳列表與上方卡片是「當下事實」，不動。
watch(selectedMonth, async () => {
  try {
    summary.value = await getSummary(selectedMonth.value)
  }
  catch {
    toast.error('載入資料失敗', { description: '請稍後再試' })
  }
})

// 掃描完成（不論從哪一頁觸發）自動刷新總覽。
const { onComplete } = useScanEvents()
onComplete.value = () => {
  fetchData()
}

const emailConfigured = ref(true) // 防閃：抓到狀態前先當 true，避免誤現引導文案
onMounted(async () => {
  fetchData()
  try {
    emailConfigured.value = (await useSettingsApi().getOnboardingStatus()).emailConfigured
  }
  catch {
    // leave true — never block the overview on this hint
  }
})

useHead({ title: '總覽 - Bill Alarm' })
</script>
