<script setup lang="ts">
import { CircleCheck, Loader2 } from 'lucide-vue-next'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import type { BillDTO } from '@bill-alarm/shared/types'
import { formatAmount } from '@bill-alarm/shared/format'
import { formatYMD } from '@bill-alarm/shared/date'

const props = defineProps<{
  bill: BillDTO
  marking: boolean
}>()

const emit = defineEmits<{ pay: [] }>()

// autoDebit 只是「預定扣款」，按鈕語意是請使用者確認銀行真的扣了
const payLabel = computed(() => props.bill.bank?.autoDebit ? '確認已扣款' : '已繳')
</script>

<template>
  <Card
    class="cursor-pointer transition-colors hover:border-primary/50"
    @click="navigateTo(`/bills/${bill.id}`)"
  >
    <CardContent class="flex flex-wrap items-center justify-between gap-3 p-4">
      <div class="flex min-w-0 items-center gap-2">
        <div class="min-w-0">
          <div class="flex flex-wrap items-center gap-2">
            <span class="truncate text-sm font-medium">{{ bill.bank?.name }}</span>
            <Badge
              v-if="bill.bank?.autoDebit"
              variant="secondary"
              class="text-xs"
            >
              自動扣款
            </Badge>
          </div>
          <p class="text-xs text-muted-foreground">
            截止 {{ formatYMD(bill.dueDate) }}
          </p>
        </div>
      </div>
      <div class="flex items-center gap-3">
        <span class="font-bold whitespace-nowrap">{{ formatAmount(bill.amount) }}</span>
        <DaysRemaining
          :due-date="bill.dueDate"
          :status="bill.status"
        />
        <Button
          size="sm"
          :disabled="marking"
          :aria-label="`標記 ${bill.bank?.name} 已繳`"
          @click.stop="emit('pay')"
        >
          <Loader2
            v-if="marking"
            class="h-4 w-4 animate-spin"
          />
          <CircleCheck
            v-else
            class="h-4 w-4"
          />
          {{ payLabel }}
        </Button>
      </div>
    </CardContent>
  </Card>
</template>
