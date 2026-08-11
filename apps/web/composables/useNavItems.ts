import type { Component, ComputedRef } from 'vue'
import { CreditCard, LayoutDashboard, Receipt, Settings } from 'lucide-vue-next'

export interface NavItem {
  to: string
  label: string
  icon: Component
}

// 掃描紀錄是低頻診斷頁，不佔主導覽——入口在設定的掃描卡與掃描結果 toast。
const ALL_ITEMS: NavItem[] = [
  { to: '/', label: '總覽', icon: LayoutDashboard },
  { to: '/bills', label: '帳單', icon: Receipt },
  { to: '/banks', label: '銀行', icon: CreditCard },
  { to: '/settings', label: '設定', icon: Settings },
]

export function useNavItems(): ComputedRef<NavItem[]> {
  return computed(() => ALL_ITEMS)
}
