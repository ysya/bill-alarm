import { describe, it, expect } from 'vitest'
import {
  isValidYMD, todayYMD, addDaysYMD, daysUntil,
  formatYMD, deriveBillingPeriod, ymdFromParts,
} from '../date'

describe('isValidYMD', () => {
  it('accepts real dates, rejects malformed and impossible ones', () => {
    expect(isValidYMD('2026-07-10')).toBe(true)
    expect(isValidYMD('2026-02-29')).toBe(false) // 2026 not a leap year
    expect(isValidYMD('2024-02-29')).toBe(true)
    expect(isValidYMD('2026-13-01')).toBe(false)
    expect(isValidYMD('2026-7-1')).toBe(false)
    expect(isValidYMD('garbage')).toBe(false)
  })
})

describe('todayYMD', () => {
  it('formats the provided now in local time', () => {
    expect(todayYMD(new Date(2026, 6, 9, 23, 59))).toBe('2026-07-09')
  })
})

describe('addDaysYMD', () => {
  it('rolls over months and years', () => {
    expect(addDaysYMD('2026-07-31', 1)).toBe('2026-08-01')
    expect(addDaysYMD('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDaysYMD('2026-03-01', -1)).toBe('2026-02-28')
    expect(addDaysYMD('2026-07-10', 0)).toBe('2026-07-10')
  })
})

describe('daysUntil', () => {
  const now = new Date(2026, 6, 9, 15, 0) // local 2026-07-09
  it('counts calendar days regardless of time of day', () => {
    expect(daysUntil('2026-07-09', now)).toBe(0)
    expect(daysUntil('2026-07-10', now)).toBe(1)
    expect(daysUntil('2026-07-06', now)).toBe(-3)
    expect(daysUntil('2026-08-09', now)).toBe(31)
  })
})

describe('formatYMD', () => {
  it('renders slashes', () => {
    expect(formatYMD('2026-07-10')).toBe('2026/07/10')
  })
})

describe('deriveBillingPeriod', () => {
  it('is pure year-month arithmetic', () => {
    expect(deriveBillingPeriod('2026-07-10')).toBe('2026-06')
    expect(deriveBillingPeriod('2026-01-15')).toBe('2025-12')
  })
  it('does not overflow on month-end due dates (regression: report 2.2)', () => {
    expect(deriveBillingPeriod('2026-05-31')).toBe('2026-04')
    expect(deriveBillingPeriod('2026-03-31')).toBe('2026-02')
    expect(deriveBillingPeriod('2026-03-29')).toBe('2026-02')
  })
})

describe('ymdFromParts', () => {
  it('converts ROC years', () => {
    expect(ymdFromParts('115', '4', '3')).toBe('2026-04-03')
    expect(ymdFromParts('2026', '04', '03')).toBe('2026-04-03')
  })
  it('rejects impossible dates and out-of-range years', () => {
    expect(ymdFromParts('115', '2', '30')).toBeNull()
    expect(ymdFromParts('1990', '1', '1')).toBeNull()
    expect(ymdFromParts('abc', '1', '1')).toBeNull()
  })
})
