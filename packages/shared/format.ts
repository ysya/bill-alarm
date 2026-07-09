import { daysUntil } from './date'

export function formatAmount(amount: number): string {
  return `NT$ ${amount.toLocaleString('zh-TW')}`
}

export type DaysRemainingTone = 'overdue' | 'today' | 'soon' | 'normal'

export function daysRemainingInfo(
  dueYMD: string,
  now: Date = new Date(),
): { days: number; text: string; tone: DaysRemainingTone } {
  const days = daysUntil(dueYMD, now)
  if (days < 0) return { days, text: `已逾期 ${Math.abs(days)} 天`, tone: 'overdue' }
  if (days === 0) return { days, text: '今天到期', tone: 'today' }
  if (days <= 3) return { days, text: `剩 ${days} 天`, tone: 'soon' }
  return { days, text: `剩 ${days} 天`, tone: 'normal' }
}
