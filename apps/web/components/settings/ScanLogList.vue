<script setup lang="ts">
import { AlertCircle, CheckCircle2, ChevronDown, ChevronUp, RefreshCw } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import type { ScanErrorStage, ScanLogDTO } from '~/composables/useSettingsApi'

const settingsApi = useSettingsApi()

const logs = ref<ScanLogDTO[]>([])
const loading = ref(false)
const expanded = ref<Set<string>>(new Set())

async function load() {
  loading.value = true
  try {
    const { logs: data } = await settingsApi.listScanLogs(20)
    logs.value = data
  } catch (e) {
    toast.error('載入掃描紀錄失敗', { description: String(e) })
  } finally {
    loading.value = false
  }
}

defineExpose({ refresh: load })

onMounted(load)

function toggle(id: string) {
  const next = new Set(expanded.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  expanded.value = next
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString('zh-TW', { hour12: false })
}

function durationMs(start: string, end: string | null): string {
  if (!end) return '進行中'
  const ms = new Date(end).getTime() - new Date(start).getTime()
  if (ms < 1000) return `${ms} ms`
  return `${(ms / 1000).toFixed(1)} s`
}

const STAGE_LABELS: Record<ScanErrorStage, string> = {
  email_search: '信箱搜尋',
  email_fetch: '取信',
  pdf_password: 'PDF 密碼',
  pdf_extract: 'PDF 解析',
  parse_failed: '帳單解析',
  sanity_check: '合理性檢查',
  unexpected: '未預期錯誤',
  notification: '通知發送',
}

function stageLabel(stage: ScanErrorStage): string {
  return STAGE_LABELS[stage] ?? stage
}
</script>

<template>
  <div class="space-y-3">
    <div class="flex items-center justify-between">
      <div>
        <h3 class="text-sm font-semibold">掃描紀錄</h3>
        <p class="text-xs text-muted-foreground">最近 20 次自動或手動掃描的結果與失敗原因。</p>
      </div>
      <Button size="sm" variant="ghost" :disabled="loading" @click="load">
        <RefreshCw class="mr-1 h-3.5 w-3.5" :class="{ 'animate-spin': loading }" />
        重新整理
      </Button>
    </div>

    <div v-if="loading && logs.length === 0" class="space-y-2">
      <div v-for="i in 3" :key="i" class="h-12 animate-pulse rounded-lg bg-muted" />
    </div>

    <div v-else-if="logs.length === 0" class="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
      尚無掃描紀錄。
    </div>

    <ul v-else class="space-y-2">
      <li
        v-for="log in logs"
        :key="log.id"
        class="rounded-lg border border-border"
      >
        <button
          type="button"
          class="flex w-full items-center justify-between gap-3 p-3 text-left hover:bg-muted/50"
          @click="toggle(log.id)"
        >
          <div class="flex items-center gap-3 min-w-0">
            <component
              :is="log.errorCount > 0 ? AlertCircle : CheckCircle2"
              :class="log.errorCount > 0 ? 'text-destructive' : 'text-green-500'"
              class="h-4 w-4 shrink-0"
            />
            <div class="min-w-0">
              <div class="flex items-center gap-2 text-sm">
                <span class="font-medium">{{ formatTime(log.startedAt) }}</span>
                <Badge variant="outline" class="text-[10px] uppercase">
                  {{ log.trigger === 'manual' ? '手動' : '自動' }}
                </Badge>
              </div>
              <p class="text-xs text-muted-foreground">
                掃描 {{ log.scanned }} 封・新帳單 {{ log.newBillsCount }} 筆・耗時 {{ durationMs(log.startedAt, log.finishedAt) }}
                <span v-if="log.errorCount > 0" class="text-destructive">・{{ log.errorCount }} 個錯誤</span>
              </p>
            </div>
          </div>
          <component
            :is="expanded.has(log.id) ? ChevronUp : ChevronDown"
            class="h-4 w-4 shrink-0 text-muted-foreground"
          />
        </button>

        <div v-if="expanded.has(log.id)" class="border-t border-border p-3 space-y-2">
          <div v-if="log.fatalError" class="rounded-md bg-destructive/10 p-2 text-xs">
            <span class="font-medium text-destructive">致命錯誤：</span>
            <span class="text-destructive/90">{{ log.fatalError }}</span>
          </div>

          <div v-if="log.errors.length === 0 && !log.fatalError" class="text-xs text-muted-foreground">
            這次掃描沒有錯誤。
          </div>

          <ul v-if="log.errors.length > 0" class="space-y-1.5">
            <li
              v-for="(err, idx) in log.errors"
              :key="idx"
              class="rounded-md border border-border/60 bg-muted/30 p-2 text-xs"
            >
              <div class="flex flex-wrap items-center gap-1.5">
                <Badge variant="secondary" class="text-[10px]">{{ stageLabel(err.stage) }}</Badge>
                <span v-if="err.bank" class="font-medium">{{ err.bank }}</span>
                <span v-if="err.msgId" class="font-mono text-[10px] text-muted-foreground">msg:{{ err.msgId }}</span>
              </div>
              <p class="mt-1 break-words text-muted-foreground">{{ err.reason }}</p>
            </li>
          </ul>
        </div>
      </li>
    </ul>
  </div>
</template>
