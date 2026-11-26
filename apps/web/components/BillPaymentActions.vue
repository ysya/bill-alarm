<script setup lang="ts">
import { CircleCheck, Loader2 } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import type { BillDTO } from '@bill-alarm/shared/types'
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
const updatingTransfer = ref(false)
const markingPaid = computed(() => markingIds.value.has(props.bill.id))
const confirmsDebit = computed(() => props.bill.bank?.autoDebit || props.bill.transferredAt)
const payLabel = computed(() => {
  if (confirmsDebit.value) return '確認已扣繳'
  return props.compact ? '已繳' : '標記已繳'
})
const busy = computed(() => props.disabled || markingPaid.value || updatingTransfer.value)

function confirmPayment() {
  // The undo toast can outlive this row, so use the page's refresh callback.
  markPaid(props.bill, props.refresh)
}

async function toggleTransfer() {
  const transferred = !props.bill.transferredAt
  updatingTransfer.value = true
  try {
    await setTransferred(props.bill.id, transferred)
    toast.success(transferred ? '已標記轉帳，等待扣繳' : '已撤銷轉帳標記')
    props.refresh()
  }
  catch (e) {
    toast.error('操作失敗', { description: apiErrorMessage(e) })
  }
  finally {
    updatingTransfer.value = false
  }
}
</script>

<template>
  <div class="flex flex-wrap items-center gap-2">
    <Button
      v-if="confirmsDebit"
      variant="outline"
      :size="compact ? 'sm' : 'default'"
      :disabled="busy"
      @click.stop="toggleTransfer"
    >
      <Loader2
        v-if="updatingTransfer"
        class="h-4 w-4 animate-spin"
      />
      {{ bill.transferredAt ? '撤銷轉帳標記' : '標記已轉帳' }}
    </Button>
    <Button
      :size="compact ? 'sm' : 'default'"
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
  </div>
</template>
