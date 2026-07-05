import type { Component, ComputedRef } from 'vue'
import { CreditCard, History, LayoutDashboard, Receipt, Settings } from 'lucide-vue-next'

export interface NavItem {
  to: string
  label: string
  icon: Component
}

const ALL_ITEMS: NavItem[] = [
  { to: '/', label: '總覽', icon: LayoutDashboard },
  { to: '/bills', label: '帳單', icon: Receipt },
  { to: '/banks', label: '銀行', icon: CreditCard },
  { to: '/scan-logs', label: '紀錄', icon: History },
  { to: '/settings', label: '設定', icon: Settings },
]

// Members don't manage banks; while `me` is still loading (null) show the full
// set so the admin doesn't see tabs pop in on first paint.
export function useNavItems(): ComputedRef<NavItem[]> {
  const me = useMe()
  return computed(() =>
    me.value?.role === 'member' ? ALL_ITEMS.filter(i => i.to !== '/banks') : ALL_ITEMS,
  )
}
