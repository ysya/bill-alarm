<script setup lang="ts">
const navItems = useNavItems()
const route = useRoute()

function isActive(to: string): boolean {
  return to === '/' ? route.path === '/' : route.path.startsWith(to)
}
</script>

<template>
  <nav class="md:hidden fixed bottom-0 left-0 right-0 z-50 border-t border-border bg-background/85 backdrop-blur pb-safe">
    <div class="flex h-14 items-stretch">
      <NuxtLink
        v-for="item in navItems"
        :key="item.to"
        :to="item.to"
        class="flex flex-1 flex-col items-center justify-center gap-0.5 transition-colors"
        :class="isActive(item.to) ? 'text-primary' : 'text-muted-foreground'"
      >
        <component
          :is="item.icon"
          class="h-5 w-5"
        />
        <span class="text-[11px] leading-none">{{ item.label }}</span>
      </NuxtLink>
    </div>
  </nav>
</template>
