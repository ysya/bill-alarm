import { describe, it, expect } from 'vitest'
import { BillStatus } from '@bill-alarm/shared/types'
import { setupTestDb } from '../../services/__tests__/helpers/test-db.js'

setupTestDb()
process.env.LOG_LEVEL = 'silent'

const { default: app } = await import('@/index.js')
const { default: prisma } = await import('@/prisma.js')

function cookieOf(res: Response): string {
  return res.headers.get('set-cookie')?.split(';')[0] ?? ''
}

const setup = await app.request('/api/auth/setup', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'boss', password: 'admin-password' }),
})
const adminCookie = cookieOf(setup)

describe('bills: dueDate validity', () => {
  it('PATCH /api/bills/:id with an impossible calendar date (2026-02-31) returns 400 and does not write', async () => {
    const user = await prisma.user.findUnique({ where: { username: 'boss' } })
    const bank = await prisma.bank.create({
      data: { name: 'Validity Bank', emailSenderPattern: 'v@v', emailSubjectPattern: 'v', userId: user!.id },
    })
    const bill = await prisma.bill.create({
      data: { bankId: bank.id, billingPeriod: '2026-06', amount: 100, dueDate: '2026-07-15' },
    })

    const res = await app.request(`/api/bills/${bill.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ dueDate: '2026-02-31' }),
    })
    expect(res.status).toBe(400)
    const stored = await prisma.bill.findUnique({ where: { id: bill.id } })
    expect(stored?.dueDate).toBe('2026-07-15')
  })

  it('PATCH /api/bills/:id with a valid calendar date (2026-02-28) returns 200 and writes', async () => {
    const user = await prisma.user.findUnique({ where: { username: 'boss' } })
    const bank = await prisma.bank.create({
      data: { name: 'Validity Bank 2', emailSenderPattern: 'v2@v', emailSubjectPattern: 'v2', userId: user!.id },
    })
    const bill = await prisma.bill.create({
      data: { bankId: bank.id, billingPeriod: '2026-01', amount: 200, dueDate: '2026-07-15' },
    })

    const res = await app.request(`/api/bills/${bill.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ dueDate: '2026-02-28' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.dueDate).toBe('2026-02-28')
  })
})

describe('bills: paidAt state transitions on PATCH', () => {
  it('PATCH status -> paid sets paidAt when it was not already set', async () => {
    const user = await prisma.user.findUnique({ where: { username: 'boss' } })
    const bank = await prisma.bank.create({
      data: { name: 'PaidAt Bank', emailSenderPattern: 'pa@pa', emailSubjectPattern: 'pa', userId: user!.id },
    })
    const bill = await prisma.bill.create({
      data: { bankId: bank.id, billingPeriod: '2026-07', amount: 500, dueDate: '2026-07-15', status: BillStatus.PENDING },
    })
    expect(bill.paidAt).toBeNull()

    const res = await app.request(`/api/bills/${bill.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ status: 'paid' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('paid')
    expect(body.paidAt).not.toBeNull()
    const stored = await prisma.bill.findUnique({ where: { id: bill.id } })
    expect(stored?.paidAt).not.toBeNull()
  })

  it('PATCH status paid -> pending clears paidAt back to null', async () => {
    const user = await prisma.user.findUnique({ where: { username: 'boss' } })
    const bank = await prisma.bank.create({
      data: { name: 'PaidAt Bank 2', emailSenderPattern: 'pa2@pa', emailSubjectPattern: 'pa2', userId: user!.id },
    })
    const bill = await prisma.bill.create({
      data: {
        bankId: bank.id,
        billingPeriod: '2026-08',
        amount: 600,
        dueDate: '2026-08-15',
        status: BillStatus.PAID,
        paidAt: new Date('2026-08-01T00:00:00Z'),
      },
    })

    const res = await app.request(`/api/bills/${bill.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ status: 'pending' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('pending')
    expect(body.paidAt).toBeNull()
    const stored = await prisma.bill.findUnique({ where: { id: bill.id } })
    expect(stored?.paidAt).toBeNull()
  })

  it('PATCH status -> paid when paidAt is already set leaves the existing paidAt untouched', async () => {
    const user = await prisma.user.findUnique({ where: { username: 'boss' } })
    const bank = await prisma.bank.create({
      data: { name: 'PaidAt Bank 3', emailSenderPattern: 'pa3@pa', emailSubjectPattern: 'pa3', userId: user!.id },
    })
    const originalPaidAt = new Date('2026-06-01T00:00:00Z')
    const bill = await prisma.bill.create({
      data: {
        bankId: bank.id,
        billingPeriod: '2026-06',
        amount: 700,
        dueDate: '2026-06-15',
        status: BillStatus.PAID,
        paidAt: originalPaidAt,
      },
    })

    const res = await app.request(`/api/bills/${bill.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ status: 'paid' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(new Date(body.paidAt).toISOString()).toBe(originalPaidAt.toISOString())
  })

  it('PATCH without a status field does not touch paidAt', async () => {
    const user = await prisma.user.findUnique({ where: { username: 'boss' } })
    const bank = await prisma.bank.create({
      data: { name: 'PaidAt Bank 4', emailSenderPattern: 'pa4@pa', emailSubjectPattern: 'pa4', userId: user!.id },
    })
    const bill = await prisma.bill.create({
      data: { bankId: bank.id, billingPeriod: '2026-05', amount: 800, dueDate: '2026-05-15', status: BillStatus.PENDING },
    })

    const res = await app.request(`/api/bills/${bill.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ amount: 900 }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.amount).toBe(900)
    expect(body.paidAt).toBeNull()
  })
})
