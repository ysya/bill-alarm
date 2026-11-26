<script setup lang="ts">
import { daysRemainingInfo, type DaysRemainingTone } from '@bill-alarm/shared/format'
import { BillStatus, isAwaitingDebit, type BillDTO } from '@bill-alarm/shared/types'

const props = defineProps<{ bill: BillDTO, plain?: boolean }>()

const TONE_CLASS: Record<DaysRemainingTone, string> = {
  overdue: 'text-red-500 bg-red-500/10',
  today: 'text-red-500 bg-red-500/10',
  soon: 'text-yellow-500 bg-yellow-500/10',
  normal: 'text-muted-foreground bg-muted',
}

const TEXT_CLASS: Record<DaysRemainingTone, string> = {
  overdue: 'text-red-500',
  today: 'text-red-500',
  soon: 'text-yellow-500',
  normal: 'text-muted-foreground',
}

const info = computed(() => {
  const { bill } = props
  if (bill.status === BillStatus.PAID || bill.status === BillStatus.NO_PAYMENT) return null
  const remaining = daysRemainingInfo(bill.dueDate)
  if (remaining.days < 0 && isAwaitingDebit(bill)) {
    return { text: '請確認扣繳結果', tone: 'normal' as const }
  }
  return remaining
})
</script>

<template>
  <span
    v-if="info"
    class="whitespace-nowrap text-xs font-medium"
    :class="plain ? TEXT_CLASS[info.tone] : ['inline-flex items-center rounded-md px-2 py-0.5', TONE_CLASS[info.tone]]"
  >{{ info.text }}</span>
</template>
