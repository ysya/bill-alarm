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

describe('banks: delete guard + cascades', () => {
  it('DELETE /api/banks/:id on a custom bank with bills returns 400 with a friendly count message', async () => {
    const user = await prisma.user.findUnique({ where: { username: 'boss' } })
    const bank = await prisma.bank.create({
      data: { name: 'Custom Bank', emailSenderPattern: 'x@x', emailSubjectPattern: 'b', userId: user!.id },
    })
    await prisma.bill.create({
      data: { bankId: bank.id, billingPeriod: '2026-07', amount: 100, dueDate: '2026-07-10' },
    })
    await prisma.bill.create({
      data: { bankId: bank.id, billingPeriod: '2026-08', amount: 200, dueDate: '2026-08-10' },
    })

    const res = await app.request(`/api/banks/${bank.id}`, { method: 'DELETE', headers: { Cookie: adminCookie } })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('此銀行尚有 2 筆帳單，請先刪除帳單')
    // guard rejected the request: bank must still exist, untouched
    expect(await prisma.bank.count({ where: { id: bank.id } })).toBe(1)
  })

  it('DELETE /api/banks/:id on a custom bank with no bills succeeds and removes the bank', async () => {
    const user = await prisma.user.findUnique({ where: { username: 'boss' } })
    const bank = await prisma.bank.create({
      data: { name: 'Empty Bank', emailSenderPattern: 'y@y', emailSubjectPattern: 'c', userId: user!.id },
    })

    const res = await app.request(`/api/banks/${bank.id}`, { method: 'DELETE', headers: { Cookie: adminCookie } })
    expect(res.status).toBe(200)
    expect(await prisma.bank.count({ where: { id: bank.id } })).toBe(0)
  })

  it('DELETE /api/bills/:id cascades to delete its notification logs', async () => {
    const user = await prisma.user.findUnique({ where: { username: 'boss' } })
    const bank = await prisma.bank.create({
      data: { name: 'Cascade Bank', emailSenderPattern: 'z@z', emailSubjectPattern: 'd', userId: user!.id },
    })
    const bill = await prisma.bill.create({
      data: { bankId: bank.id, billingPeriod: '2026-09', amount: 300, dueDate: '2026-09-10' },
    })
    await prisma.notificationLog.create({
      data: { billId: bill.id, channel: 'telegram', message: 'hi', success: true },
    })

    const res = await app.request(`/api/bills/${bill.id}`, { method: 'DELETE', headers: { Cookie: adminCookie } })
    expect(res.status).toBe(200)
    expect(await prisma.bill.count({ where: { id: bill.id } })).toBe(0)
    expect(await prisma.notificationLog.count({ where: { billId: bill.id } })).toBe(0)
  })
})
