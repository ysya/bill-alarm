import { describe, it, expect } from 'vitest'
import { parseBillResponse } from '../llm-parser.js'

describe('parseBillResponse', () => {
  it('uses LLM billingPeriod when valid', () => {
    const bill = parseBillResponse(JSON.stringify({
      amount: 1000, minimumPayment: 100, dueDate: '2026-07-13', billingPeriod: '2026-06',
    }))
    expect(bill?.billingPeriod).toBe('2026-06')
  })

  it('derives previous month without end-of-month overflow', () => {
    // 舊實作 setMonth(-1) 在 3/31 會溢位成 3 月；正確應為 2 月
    const bill = parseBillResponse(JSON.stringify({
      amount: 1000, minimumPayment: null, dueDate: '2026-03-31', billingPeriod: null,
    }))
    expect(bill?.billingPeriod).toBe('2026-02')
  })

  it('crosses year boundary for January due dates', () => {
    const bill = parseBillResponse(JSON.stringify({
      amount: 1000, minimumPayment: null, dueDate: '2026-01-15', billingPeriod: null,
    }))
    expect(bill?.billingPeriod).toBe('2025-12')
  })

  it('returns null for unparseable payloads', () => {
    expect(parseBillResponse('not json')).toBeNull()
    expect(parseBillResponse(JSON.stringify({ amount: null, dueDate: '2026-01-01' }))).toBeNull()
  })
})
