import type { Component } from 'vue'
import { CreditCard, History, LayoutDashboard, Receipt, Settings } from 'lucide-vue-next'

export interface NavItem {
  to: string
  label: string
  icon: Component
}

export function useNavItems(): NavItem[] {
  return [
    { to: '/', label: '總覽', icon: LayoutDashboard },
    { to: '/bills', label: '帳單', icon: Receipt },
    { to: '/banks', label: '銀行', icon: CreditCard },
    { to: '/scan-logs', label: '紀錄', icon: History },
    { to: '/settings', label: '設定', icon: Settings },
  ]
}
