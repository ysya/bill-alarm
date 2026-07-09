import { describe, it, expect } from 'vitest'
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
