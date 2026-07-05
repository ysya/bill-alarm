<template>
  <div class="min-h-screen bg-background text-foreground">
    <template v-if="bareShell">
      <NuxtPage />
    </template>
    <div v-else class="flex">
      <!-- Desktop Sidebar -->
      <aside class="hidden md:flex w-60 flex-col border-r border-border min-h-screen p-4 gap-2">
        <h1 class="text-lg font-bold px-3 py-2 mb-4">Bill Alarm</h1>
        <NuxtLink
          v-for="item in navItems"
          :key="item.to"
          :to="item.to"
          class="flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors hover:bg-accent"
          active-class="bg-accent text-accent-foreground"
        >
          <component :is="item.icon" class="w-4 h-4" />
          {{ item.label }}
        </NuxtLink>
      </aside>

      <!-- Mobile Header -->
      <div class="md:hidden fixed top-0 left-0 right-0 z-50 bg-background/85 backdrop-blur border-b border-border pt-safe">
        <div class="flex items-center px-4 h-14">
          <h1 class="text-lg font-bold">{{ pageTitle }}</h1>
        </div>
      </div>

      <!-- Main Content -->
      <main class="flex-1 p-4 pb-24 md:p-8 md:pb-8 mt-header-safe md:mt-0 min-h-screen">
        <NuxtPage />
      </main>
      <BottomNav />
    </div>
    <Sonner position="top-right" />
  </div>
</template>

<script setup lang="ts">
import 'vue-sonner/style.css'
import { Toaster as Sonner } from '@/components/ui/sonner'

// Set dark mode on html element for unocss-preset-shadcn
onMounted(() => {
  document.documentElement.classList.add('dark')
})

const route = useRoute()
const bareShell = computed(() => route.path === '/login' || route.path === '/setup')

const { me, fetchMe } = useAuth()
onMounted(() => {
  if (!bareShell.value) fetchMe()
})
// After login/setup the route flips bare→shell; fetch the profile then.
watch(bareShell, (bare) => {
  if (!bare && !me.value) fetchMe()
})

const navItems = useNavItems()

const pageTitle = computed(() => {
  const hit = navItems.value.find(item =>
    item.to === '/' ? route.path === '/' : route.path.startsWith(item.to),
  )
  return hit?.label ?? 'Bill Alarm'
})
</script>
