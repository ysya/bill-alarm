<script setup lang="ts">
import { BillStatus, isAwaitingDebit, statusBadgeClass, statusLabel, type BillDTO } from '@bill-alarm/shared/types'
import { Badge } from '@/components/ui/badge'

const props = defineProps<{ bill: BillDTO }>()
const awaitingDebit = computed(() => isAwaitingDebit(props.bill))
const label = computed(() => {
  if (awaitingDebit.value) return '已轉帳・待扣繳'
  if (props.bill.status === BillStatus.PAID && props.bill.paidByAutoDebit) return '已扣繳'
  if (props.bill.status === BillStatus.PENDING && props.bill.bank?.autoDebit) return '待備款'
  return statusLabel(props.bill.status)
})
</script>

<template>
  <Badge
    :variant="awaitingDebit ? 'secondary' : 'default'"
    :class="awaitingDebit ? '' : statusBadgeClass(bill.status)"
  >
    {{ label }}
  </Badge>
</template>
