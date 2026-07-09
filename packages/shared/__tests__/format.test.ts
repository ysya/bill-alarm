import { describe, it, expect } from 'vitest'
import { formatAmount, daysRemainingInfo } from '../format'

describe('formatAmount', () => {
  it('formats NTD with thousands separators', () => {
    expect(formatAmount(69988)).toBe('NT$ 69,988')
    expect(formatAmount(0)).toBe('NT$ 0')
    expect(formatAmount(-1200)).toBe('NT$ -1,200')
  })
})

describe('daysRemainingInfo', () => {
  const now = new Date(2026, 6, 9) // local 2026-07-09
  it('classifies overdue / today / soon / normal', () => {
    expect(daysRemainingInfo('2026-07-06', now)).toEqual({ days: -3, text: '已逾期 3 天', tone: 'overdue' })
    expect(daysRemainingInfo('2026-07-09', now)).toEqual({ days: 0, text: '今天到期', tone: 'today' })
    expect(daysRemainingInfo('2026-07-12', now)).toEqual({ days: 3, text: '剩 3 天', tone: 'soon' })
    expect(daysRemainingInfo('2026-07-20', now)).toEqual({ days: 11, text: '剩 11 天', tone: 'normal' })
  })
})
