<script setup lang="ts">
import { FileClock, Mail } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import type { ScanLogDTO } from '@bill-alarm/shared/scan'

defineProps<{
  emailConfigured: boolean
  hasActiveBank: boolean
}>()

const settingsApi = useSettingsApi()

const scanning = ref(false)
const lastLog = ref<ScanLogDTO | null>(null)

const { state: scanProgress } = useScanEvents()

const scanInProgress = computed(() => scanning.value || scanProgress.value.active)
const progressPercent = computed(() =>
  scanProgress.value.total > 0
    ? Math.round((scanProgress.value.idx / scanProgress.value.total) * 100)
    : 0,
)

async function fetchLastLog() {
  try {
    const { logs } = await settingsApi.listScanLogs(1)
    lastLog.value = logs[0] ?? null
  }
  catch {
    // summary is a nicety — never block the card on it
  }
}

onMounted(fetchLastLog)

// When a live (SSE) scan finishes, refresh the summary line.
watch(() => scanProgress.value.active, (active, was) => {
  if (was && !active) fetchLastLog()
})

const lastLogText = computed(() => {
  const l = lastLog.value
  if (!l) return null
  const when = new Date(l.startedAt).toLocaleString('zh-TW', {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
  const base = `上次掃描：${when} ・掃描 ${l.scanned} 封・新帳單 ${l.newBillsCount} 筆`
  return l.errorCount > 0 ? `${base}・${l.errorCount} 個錯誤` : base
})

async function handleScan() {
  scanning.value = true
  try {
    const result = await settingsApi.triggerScan()
    const errorCount = result.errors?.length ?? 0
    const firstReason = result.errors?.[0]?.reason
    const summary = `掃描 ${result.scanned} 封郵件，發現 ${result.newBills} 筆新帳單${errorCount > 0 ? `，${errorCount} 個錯誤` : ''}。`
    const desc = errorCount > 0 && firstReason ? `${summary}\n首個錯誤：${firstReason}` : summary
    const action = { label: '查看紀錄', onClick: () => navigateTo('/scan-logs') }
    if (errorCount > 0) {
      toast.warning('郵件掃描完成（有錯誤）', { description: desc, action })
    }
    else {
      toast.success('郵件掃描完成', { description: desc, action })
    }
  }
  catch (e) {
    console.error('[scan] failed:', e)
    const status = (e as { response?: { status?: number } })?.response?.status
    const desc = status === 404
      ? '掃描端點不存在 (HTTP 404) — 請強制重整網頁或確認 server 已更新到最新版本'
      : status
        ? `HTTP ${status}：${(e as Error).message}`
        : String(e)
    toast.error('掃描失敗', { description: desc })
  }
  finally {
    scanning.value = false
    await fetchLastLog()
  }
}
</script>

<template>
  <Card class="space-y-3 p-4">
    <div class="flex items-center gap-3">
      <Mail class="h-5 w-5 shrink-0 text-muted-foreground" />
      <div class="min-w-0 flex-1">
        <p class="text-sm font-medium">
          掃描信箱
        </p>
        <p class="text-xs text-muted-foreground">
          {{ lastLogText ?? '尚未掃描過。' }}
        </p>
      </div>
    </div>

    <p
      v-if="!emailConfigured"
      class="rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground"
    >
      先完成上方信箱授權，才能掃描帳單郵件。
    </p>
    <p
      v-else-if="!hasActiveBank"
      class="rounded-lg border border-yellow-500/40 bg-yellow-500/10 p-3 text-xs text-yellow-600 dark:text-yellow-500"
    >
      尚未啟用任何銀行，掃描不會找到帳單——先到
      <NuxtLink
        to="/banks"
        class="underline font-medium"
      >銀行</NuxtLink> 頁啟用。
    </p>

    <div class="flex flex-wrap gap-2">
      <Button
        size="sm"
        variant="outline"
        :disabled="scanInProgress || !emailConfigured"
        @click="handleScan"
      >
        <Mail class="mr-2 h-4 w-4" />
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
          立即掃描郵件
        </template>
      </Button>
      <Button
        size="sm"
        variant="ghost"
        as-child
      >
        <NuxtLink to="/scan-logs">
          <FileClock class="mr-2 h-4 w-4" />
          掃描紀錄
        </NuxtLink>
      </Button>
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
  </Card>
</template>
