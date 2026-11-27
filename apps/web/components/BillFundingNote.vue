<script setup lang="ts">
import { formatAmount } from '@bill-alarm/shared/format'
import { BillStatus, fundingRemaining, type BillDTO } from '@bill-alarm/shared/types'

const props = defineProps<{ bill: BillDTO, showWhenEqual?: boolean }>()
const remaining = computed(() => fundingRemaining(props.bill))
const unpaid = computed(() => props.bill.status === BillStatus.PENDING || props.bill.status === BillStatus.OVERDUE)
</script>

<template>
  <p
    v-if="bill.transferredAmount != null && (showWhenEqual || bill.transferredAmount !== bill.amount)"
    class="text-sm text-muted-foreground"
  >
    已轉帳 {{ formatAmount(bill.transferredAmount) }}<span v-if="unpaid && remaining > 0">，還需補 {{ formatAmount(remaining) }}</span>
  </p>
</template>
