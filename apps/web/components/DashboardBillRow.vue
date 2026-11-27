<script setup lang="ts">
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import type { BillDTO } from '@bill-alarm/shared/types'
import { formatAmount } from '@bill-alarm/shared/format'
import { formatYMD } from '@bill-alarm/shared/date'

defineProps<{ bill: BillDTO, refresh: () => void }>()
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
            <NuxtLink
              :to="`/bills/${bill.id}`"
              class="truncate text-sm font-medium hover:underline"
              @click.stop
            >{{ bill.bank?.name }}</NuxtLink>
            <BillStatusBadge
              v-if="bill.transferredAt"
              :bill="bill"
            />
            <Badge
              v-else-if="bill.bank?.autoDebit"
              variant="secondary"
              class="text-xs"
            >
              自動扣款
            </Badge>
          </div>
          <p class="text-xs text-muted-foreground">
            截止 {{ formatYMD(bill.dueDate) }}
          </p>
          <BillFundingNote :bill="bill" />
        </div>
      </div>
      <div class="flex flex-wrap items-center gap-3">
        <span class="font-bold whitespace-nowrap">{{ formatAmount(bill.amount) }}</span>
        <DaysRemaining :bill="bill" />
        <BillPaymentActions
          :bill="bill"
          :refresh="refresh"
          compact
        />
      </div>
    </CardContent>
  </Card>
</template>
