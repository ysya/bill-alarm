<script setup lang="ts">
import { daysRemainingInfo, type DaysRemainingTone } from '@bill-alarm/shared/format'

const props = defineProps<{ dueDate: string, status?: string }>()

const TONE_CLASS: Record<DaysRemainingTone, string> = {
  overdue: 'text-red-500 bg-red-500/10',
  today: 'text-red-500 bg-red-500/10',
  soon: 'text-yellow-500 bg-yellow-500/10',
  normal: 'text-muted-foreground bg-muted',
}

const info = computed(() =>
  props.status === 'paid' || props.status === 'no_payment' ? null : daysRemainingInfo(props.dueDate))
</script>

<template>
  <span
    v-if="info"
    class="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium"
    :class="TONE_CLASS[info.tone]"
  >{{ info.text }}</span>
</template>
