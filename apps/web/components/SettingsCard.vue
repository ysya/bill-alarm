<script setup lang="ts">
import type { Component } from 'vue'
import { ChevronDown } from 'lucide-vue-next'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'

const props = withDefaults(defineProps<{
  icon: Component
  title: string
  status: 'ok' | 'unset' | 'error'
  statusText?: string
  defaultOpen?: boolean
}>(), { statusText: undefined, defaultOpen: false })

const open = ref(props.defaultOpen)

const STATUS_TEXT: Record<'ok' | 'unset' | 'error', string> = {
  ok: '已設定',
  unset: '未設定',
  error: '錯誤',
}
const STATUS_CLASS: Record<'ok' | 'unset' | 'error', string> = {
  ok: 'border-green-500/40 bg-green-500/10 text-green-500',
  unset: 'border-border bg-muted text-muted-foreground',
  error: 'border-destructive/40 bg-destructive/10 text-destructive',
}

const badgeText = computed(() => props.statusText ?? STATUS_TEXT[props.status])
</script>

<template>
  <Card class="overflow-hidden py-0 gap-0">
    <Collapsible v-model:open="open">
      <CollapsibleTrigger
        class="flex w-full min-h-11 items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/50"
      >
        <component
          :is="icon"
          class="h-5 w-5 shrink-0 text-muted-foreground"
        />
        <span class="min-w-0 flex-1 truncate text-sm font-semibold">{{ title }}</span>
        <Badge
          variant="outline"
          class="shrink-0"
          :class="STATUS_CLASS[status]"
        >
          {{ badgeText }}
        </Badge>
        <ChevronDown
          class="h-4 w-4 shrink-0 text-muted-foreground transition-transform"
          :class="{ 'rotate-180': open }"
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div class="border-t border-border px-4 py-4">
          <slot />
        </div>
      </CollapsibleContent>
    </Collapsible>
  </Card>
</template>
