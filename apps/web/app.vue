<template>
  <div class="min-h-screen bg-background text-foreground">
    <div class="flex">
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
      <div class="md:hidden fixed top-0 left-0 right-0 z-50 bg-background border-b border-border">
        <div class="flex items-center justify-between px-4 h-14">
          <h1 class="text-lg font-bold">Bill Alarm</h1>
          <Sheet>
            <SheetTrigger as-child>
              <Button variant="ghost" size="icon">
                <Menu class="w-5 h-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" class="w-60 p-4">
              <SheetHeader>
                <SheetTitle>Bill Alarm</SheetTitle>
              </SheetHeader>
              <nav class="flex flex-col gap-2 mt-4">
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
              </nav>
            </SheetContent>
          </Sheet>
        </div>
      </div>

      <!-- Main Content -->
      <main class="flex-1 p-6 md:p-8 mt-14 md:mt-0 min-h-screen">
        <NuxtPage />
      </main>
    </div>
    <Sonner position="top-right" />
  </div>
</template>

<script setup lang="ts">
import 'vue-sonner/style.css'
import { LayoutDashboard, Receipt, CreditCard, Settings, Menu } from 'lucide-vue-next'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Toaster as Sonner } from '@/components/ui/sonner'

// Set dark mode on html element for unocss-preset-shadcn
onMounted(() => {
  document.documentElement.classList.add('dark')
})

const navItems = [
  { to: '/', label: '總覽', icon: LayoutDashboard },
  { to: '/bills', label: '帳單', icon: Receipt },
  { to: '/banks', label: '銀行', icon: CreditCard },
  { to: '/settings', label: '設定', icon: Settings },
]
</script>
