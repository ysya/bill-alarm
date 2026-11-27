<template>
  <div class="space-y-6">
    <InstallPrompt variant="banner" />

    <!-- Page Header -->
    <div>
      <h2 class="text-2xl font-bold tracking-tight">
        總覽
      </h2>
      <p class="text-muted-foreground">
        信用卡帳單繳費狀態一覽
      </p>
    </div>

    <Card v-if="summary">
      <CardContent class="grid gap-4 p-4 sm:grid-cols-2 sm:items-center sm:p-6">
        <NuxtLink
          to="/bills?tab=unpaid&view=funding"
          class="rounded-md focus-visible:outline-primary"
        >
          <div class="flex items-center gap-1 text-sm font-medium text-muted-foreground">
            尚需繳款或備款 <ChevronRight class="size-4" />
          </div>
          <p class="mt-1 text-3xl font-bold tabular-nums">
            {{ formatAmount(summary.totalToFund) }}
          </p>
        </NuxtLink>
        <div class="grid grid-cols-3 gap-2 border-t pt-3 sm:border-l sm:border-t-0 sm:pl-5 sm:pt-0">
          <NuxtLink
            v-for="item in metrics"
            :key="item.label"
            :to="item.to"
            class="rounded-md py-1 hover:underline"
          >
            <span class="block text-xs text-muted-foreground">{{ item.label }}</span>
            <span
              class="text-lg font-semibold tabular-nums"
              :class="item.color"
            >{{ item.count }}</span>
          </NuxtLink>
        </div>
      </CardContent>
    </Card>

    <!-- 接下來要繳（單一待辦流） -->
    <div class="space-y-4">
      <h3 class="text-lg font-semibold">
        帳單待辦
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

      <Card
        v-else-if="!summary"
        class="p-4"
      >
        <p class="text-sm">
          無法載入帳單總覽。
        </p>
        <Button
          variant="outline"
          size="sm"
          @click="fetchData"
        >
          重新載入
        </Button>
      </Card>

      <!-- 未授權信箱：中性引導，不慶祝 -->
      <Card
        v-else-if="!emailConfigured && summary.pendingCount === 0"
        class="py-8"
      >
        <CardContent class="text-center text-sm text-muted-foreground">
          連接信箱並啟用銀行後，帳單會自動出現在這裡。
        </CardContent>
      </Card>

      <!-- 真正零未繳 -->
      <Card
        v-else-if="summary.pendingCount === 0"
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
        <section
          v-for="group in taskGroups"
          :key="group.view"
          class="space-y-2"
        >
          <div class="flex items-center gap-3">
            <h4
              class="text-sm font-semibold"
              :class="group.color"
            >
              {{ group.label }}（{{ group.count }}）
            </h4>
            <Separator class="flex-1" />
          </div>
          <DashboardBillRow
            v-for="bill in group.bills"
            :key="bill.id"
            :bill="bill"
            :refresh="fetchData"
          />
          <NuxtLink
            v-if="group.count > group.bills.length"
            :to="{ path: '/bills', query: { tab: 'unpaid', view: group.view } }"
            class="inline-block py-1 text-sm text-muted-foreground underline underline-offset-4"
          >
            查看全部 {{ group.count }} 筆{{ group.label }}帳單
          </NuxtLink>
        </section>
      </template>

      <p class="text-xs text-muted-foreground">
        找不到某張帳單？<NuxtLink
          to="/scan-logs"
          class="underline underline-offset-4"
        >查看掃描紀錄</NuxtLink>
      </p>
    </div>

    <section
      v-if="summary?.fundingAccounts.length"
      class="space-y-3"
    >
      <h3 class="text-lg font-semibold">
        扣款帳戶備款
      </h3>
      <Card>
        <CardContent class="divide-y p-0">
          <details
            v-for="account in summary.fundingAccounts"
            :key="account.id ?? 'unassigned'"
            class="px-4"
          >
            <summary class="cursor-pointer py-3 text-sm">
              <span class="font-semibold">{{ account.name }}</span>
              <span
                v-if="account.bankName"
                class="text-muted-foreground"
              > · {{ account.bankName }}</span>
              <span class="mt-1 flex flex-wrap justify-between gap-x-3 pl-4">
                <span>尚需 {{ formatAmount(account.remaining) }}</span>
                <span class="text-muted-foreground">最近截止 {{ formatYMD(account.nextDueDate) }} · {{ account.bills.length }} 筆</span>
              </span>
            </summary>
            <ul class="divide-y border-t">
              <li
                v-for="bill in account.bills"
                :key="bill.id"
              >
                <NuxtLink
                  :to="`/bills/${bill.id}`"
                  class="flex flex-wrap items-center justify-between gap-2 py-3 text-sm hover:underline"
                >
                  <span>{{ bill.name }} · {{ bill.period }}<small class="block text-muted-foreground">截止 {{ formatYMD(bill.dueDate) }}</small></span>
                  <span>{{ bill.remaining ? `尚需 ${formatAmount(bill.remaining)}` : '已備足' }} ›</span>
                </NuxtLink>
              </li>
            </ul>
          </details>
        </CardContent>
      </Card>
    </section>

    <OnboardingProgressCard />

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
import { CircleCheck, ChevronRight } from 'lucide-vue-next'
import type { MonthlySummaryDTO } from '@bill-alarm/shared/types'
import { formatAmount } from '@bill-alarm/shared/format'
import { formatYMD } from '@bill-alarm/shared/date'

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

const { getSummary } = useBillApi()
const summary = ref<MonthlySummaryDTO | null>(null)
const loading = ref(true)
const metrics = computed(() => {
  const data = summary.value
  if (!data) return []
  return [
    { label: '待確認扣繳', count: data.tasks.awaitingCount, to: '/bills?tab=unpaid&view=awaiting', color: '' },
    { label: '逾期需處理', count: data.overdueCount, to: '/bills?tab=unpaid&view=overdue', color: data.overdueCount ? 'text-destructive' : '' },
    { label: '本期已繳', count: data.paidCount, to: `/bills?tab=paid&period=${data.paidBillingPeriod}`, color: '' },
  ]
})
const taskGroups = computed(() => {
  const data = summary.value
  if (!data) return []
  return [
    { label: '已逾期', view: 'overdue', count: data.overdueCount, bills: data.tasks.overdue, color: 'text-red-500' },
    { label: '待確認扣繳', view: 'awaiting', count: data.tasks.awaitingCount, bills: data.tasks.awaiting, color: 'text-muted-foreground' },
    { label: '即將到期', view: 'upcoming', count: data.tasks.upcomingCount, bills: data.tasks.upcoming, color: 'text-muted-foreground' },
  ].filter(group => group.count > 0)
})

let requestId = 0
async function fetchData() {
  const id = ++requestId
  loading.value = true
  try {
    const data = await getSummary(selectedMonth.value)
    if (id === requestId) summary.value = data
  }
  catch {
    if (id === requestId) toast.error('載入資料失敗', { description: '請稍後再試' })
  }
  finally {
    if (id === requestId) loading.value = false
  }
}
watch(selectedMonth, fetchData)

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
