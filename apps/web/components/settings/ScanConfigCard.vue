<script setup lang="ts">
import { ChevronDown, ChevronUp, Clock, Mail } from 'lucide-vue-next'
import type { AcceptableValue } from 'reka-ui'
import { toast } from 'vue-sonner'
import { SCAN_INTERVAL_OPTIONS } from '~/types/settings'

const props = defineProps<{
  scan: { interval: number, rangeDays: number, queryExtra: string }
}>()

const emit = defineEmits<{ refresh: [] }>()

const settingsApi = useSettingsApi()
const scanForm = ref({ rangeDays: props.scan.rangeDays, queryExtra: props.scan.queryExtra })
const showAdvancedScan = ref(false)

watch(() => props.scan, (v) => {
  scanForm.value.rangeDays = v.rangeDays
  scanForm.value.queryExtra = v.queryExtra
})

async function handleSaveScanConfig() {
  try {
    await settingsApi.saveScanConfig({
      rangeDays: scanForm.value.rangeDays,
      queryExtra: scanForm.value.queryExtra,
    })
    toast.success('掃描條件已更新')
    emit('refresh')
  }
  catch (e) {
    toast.error('更新失敗', { description: String(e) })
  }
}

async function handleScanIntervalChange(value: AcceptableValue) {
  if (typeof value !== 'string') return
  const interval = parseInt(value)
  try {
    await settingsApi.saveScanInterval(interval)
    const label = SCAN_INTERVAL_OPTIONS.find(o => o.value === value)?.label ?? value
    toast.success(`掃描頻率已更新為「${label}」`)
    emit('refresh')
  }
  catch (e) {
    toast.error('更新失敗', { description: String(e) })
  }
}
</script>

<template>
  <div class="space-y-2">
    <p class="text-xs text-muted-foreground">
      全域掃描節奏，套用到所有使用者的信箱。
    </p>
    <SettingsConfigRow
      label="自動掃描頻率"
      description="定時檢查所有使用者信箱是否有新帳單。"
    >
      <template #icon>
        <Clock class="h-4 w-4 text-muted-foreground" />
      </template>
      <Select
        :model-value="String(scan.interval)"
        @update:model-value="handleScanIntervalChange"
      >
        <SelectTrigger class="w-40">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem
            v-for="opt in SCAN_INTERVAL_OPTIONS"
            :key="opt.value"
            :value="opt.value"
          >
            {{ opt.label }}
          </SelectItem>
        </SelectContent>
      </Select>
    </SettingsConfigRow>

    <SettingsConfigRow
      label="掃描範圍（天）"
      description="從幾天前開始搜尋郵件。預設 60 天。"
    >
      <template #icon>
        <Clock class="h-4 w-4 text-muted-foreground" />
      </template>
      <div class="flex gap-2">
        <Input
          v-model.number="scanForm.rangeDays"
          type="number"
          min="1"
          max="365"
          class="w-24"
        />
        <Button
          size="sm"
          variant="outline"
          @click="handleSaveScanConfig"
        >
          儲存
        </Button>
      </div>
    </SettingsConfigRow>

    <SettingsConfigRow label="進階搜尋條件">
      <template #icon>
        <Mail class="h-4 w-4 text-muted-foreground" />
      </template>
      <Button
        size="sm"
        variant="ghost"
        @click="showAdvancedScan = !showAdvancedScan"
      >
        {{ showAdvancedScan ? '收合' : '展開' }}
        <component
          :is="showAdvancedScan ? ChevronUp : ChevronDown"
          class="ml-1 h-4 w-4"
        />
      </Button>
      <template
        v-if="showAdvancedScan"
        #below
      >
        <div class="mt-2 ml-6 space-y-2">
          <Input
            v-model="scanForm.queryExtra"
            placeholder="例：label:bills -from:noreply"
            class="font-mono text-sm"
          />
          <p class="text-xs text-muted-foreground">
            附加到掃描查詢字串。Gmail IMAP 支援完整 Gmail 搜尋語法。
          </p>
          <Button
            size="sm"
            variant="outline"
            @click="handleSaveScanConfig"
          >
            儲存
          </Button>
        </div>
      </template>
    </SettingsConfigRow>
  </div>
</template>
