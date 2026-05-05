<script setup lang="ts">
const { state: scanProgress, onComplete } = useScanEvents()

const list = ref<{ refresh: () => Promise<void> } | null>(null)

onComplete.value = () => {
  list.value?.refresh()
}

const progressPercent = computed(() =>
  scanProgress.value.total > 0
    ? Math.round((scanProgress.value.idx / scanProgress.value.total) * 100)
    : 0,
)
</script>

<template>
  <div class="space-y-6">
    <div>
      <h1 class="text-2xl font-bold tracking-tight">掃描紀錄</h1>
      <p class="text-sm text-muted-foreground mt-1">最近的自動與手動信箱掃描結果。</p>
    </div>

    <!-- Live progress (only when active) -->
    <div v-if="scanProgress.active" class="space-y-1.5 rounded-lg border border-border bg-muted/20 p-3">
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
      <p v-if="scanProgress.bank || scanProgress.lastReason" class="truncate text-xs text-muted-foreground">
        <span v-if="scanProgress.bank" class="font-medium">{{ scanProgress.bank }}</span>
        <span v-if="scanProgress.lastReason" class="ml-1">— {{ scanProgress.lastReason }}</span>
      </p>
    </div>

    <ScanLogList ref="list" />
  </div>
</template>
