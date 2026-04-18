<script setup lang="ts">
defineProps<{
  label: string
  description?: string
}>()
</script>

<template>
  <div class="flex items-center justify-between rounded-lg border border-border p-3">
    <div class="space-y-0.5 min-w-0 flex-1">
      <div class="flex items-center gap-2">
        <slot name="icon" />
        <span class="text-sm font-medium">{{ label }}</span>
      </div>
      <p v-if="description" class="text-xs text-muted-foreground">{{ description }}</p>
    </div>
    <div class="shrink-0 ml-4">
      <slot />
    </div>
  </div>
  <slot name="below" />
</template>
