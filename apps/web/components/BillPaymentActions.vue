<script setup lang="ts">
import { CircleCheck, Loader2, Undo2 } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { fundingRemaining, type BillDTO } from '@bill-alarm/shared/types'
import { formatAmount } from '@bill-alarm/shared/format'
import { Button } from '@/components/ui/button'
import { apiErrorMessage } from '@/lib/utils'

const props = defineProps<{
  bill: BillDTO
  refresh: () => void
  compact?: boolean
  disabled?: boolean
}>()

const { setTransferred } = useBillApi()
const { markingIds, markPaid } = useMarkPaid()
const updatingTransfer = ref<'fund' | 'undo' | null>(null)
const markingPaid = computed(() => markingIds.value.has(props.bill.id))
const confirmsDebit = computed(() => props.bill.bank?.autoDebit || props.bill.transferredAt)
const canFund = computed(() => props.bill.bank?.autoDebit && fundingRemaining(props.bill) > 0)
const payLabel = computed(() => {
  if (confirmsDebit.value) return '確認已扣繳'
  return props.compact ? '已繳' : '標記已繳'
})
const busy = computed(() => props.disabled || markingPaid.value || updatingTransfer.value !== null)

function confirmPayment() {
  // The undo toast can outlive this row, so use the page's refresh callback.
  markPaid(props.bill, props.refresh)
}

async function recordTransfer(transferred: boolean) {
  if (busy.value) return
  updatingTransfer.value = transferred ? 'fund' : 'undo'
  try {
    const updated = await setTransferred(props.bill.id, transferred, props.bill.bank?.bankAccountId ?? null, transferred ? props.bill.amount : undefined)
    const remaining = fundingRemaining(updated)
    if (!transferred) toast.success('已撤銷轉帳標記')
    else if (remaining > 0) toast.success(`已記錄轉帳，尚需補 ${formatAmount(remaining)}`)
    else toast.success('已標記轉帳，等待扣繳')
  }
  catch (e) {
    toast.error('操作失敗', { description: apiErrorMessage(e) })
  }
  finally {
    props.refresh()
    updatingTransfer.value = null
  }
}
</script>

<template>
  <div class="flex flex-wrap items-center gap-2">
    <Button
      v-if="canFund"
      :size="compact ? 'sm' : 'default'"
      :disabled="busy"
      @click.stop="recordTransfer(true)"
    >
      <Loader2
        v-if="updatingTransfer === 'fund'"
        class="h-4 w-4 animate-spin"
      />
      {{ bill.transferredAt ? '標記已補足' : '標記已轉帳' }}
    </Button>
    <Button
      :size="compact ? 'sm' : 'default'"
      :variant="canFund ? 'outline' : 'default'"
      :disabled="busy"
      :aria-label="`${payLabel} ${bill.bank?.name ?? '帳單'}`"
      @click.stop="confirmPayment"
    >
      <Loader2
        v-if="markingPaid"
        class="h-4 w-4 animate-spin"
      />
      <CircleCheck
        v-else
        class="h-4 w-4"
      />
      {{ payLabel }}
    </Button>
    <Button
      v-if="bill.transferredAt"
      variant="ghost"
      :size="compact ? 'sm' : 'default'"
      :disabled="busy"
      @click.stop="recordTransfer(false)"
    >
      <Loader2
        v-if="updatingTransfer === 'undo'"
        class="h-4 w-4 animate-spin"
      />
      <Undo2
        v-else
        class="h-4 w-4"
      />
      撤銷轉帳標記
    </Button>
  </div>
</template>
