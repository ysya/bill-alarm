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

describe('banks: parserConfig write validation', () => {
  it('PATCH /api/banks/:id with malformed JSON parserConfig returns 400 and does not write', async () => {
    const user = await prisma.user.findUnique({ where: { username: 'boss' } })
    const bank = await prisma.bank.create({
      data: { name: 'Parser Bank', emailSenderPattern: 'p@p', emailSubjectPattern: 'e', userId: user!.id },
    })

    const res = await app.request(`/api/banks/${bank.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ parserConfig: '{not json' }),
    })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('parserConfig 不是合法 JSON')
    const stored = await prisma.bank.findUnique({ where: { id: bank.id } })
    expect(stored?.parserConfig).toBeNull()
  })

  it('PATCH /api/banks/:id with schema-invalid parserConfig JSON (missing dueDate) returns 400', async () => {
    const user = await prisma.user.findUnique({ where: { username: 'boss' } })
    const bank = await prisma.bank.create({
      data: { name: 'Parser Bank Bad Schema', emailSenderPattern: 'pb@p', emailSubjectPattern: 'eb', userId: user!.id },
    })

    const res = await app.request(`/api/banks/${bank.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ parserConfig: JSON.stringify({ amount: { keyword: '金額', type: 'amount' } }) }),
    })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/^parserConfig 格式錯誤：/)
    const stored = await prisma.bank.findUnique({ where: { id: bank.id } })
    expect(stored?.parserConfig).toBeNull()
  })

  it('PATCH /api/banks/:id with a valid parserConfig JSON returns 200 and stores it verbatim', async () => {
    const user = await prisma.user.findUnique({ where: { username: 'boss' } })
    const bank = await prisma.bank.create({
      data: { name: 'Parser Bank Valid', emailSenderPattern: 'pv@p', emailSubjectPattern: 'ev', userId: user!.id },
    })
    const config = JSON.stringify({
      amount: { keyword: '應繳金額', type: 'amount', nth: 1 },
      dueDate: { keyword: '繳款截止日', type: 'rocDate', nth: 1 },
    })

    const res = await app.request(`/api/banks/${bank.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ parserConfig: config }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.parserConfig).toBe(config)
    const stored = await prisma.bank.findUnique({ where: { id: bank.id } })
    expect(stored?.parserConfig).toBe(config)
  })

  it('PATCH /api/banks/:id with parserConfig: null clears it without schema validation', async () => {
    const user = await prisma.user.findUnique({ where: { username: 'boss' } })
    const bank = await prisma.bank.create({
      data: {
        name: 'Parser Bank Clear',
        emailSenderPattern: 'pc@p',
        emailSubjectPattern: 'ec',
        userId: user!.id,
        parserConfig: JSON.stringify({ amount: { keyword: 'x', type: 'amount' }, dueDate: { keyword: 'y', type: 'adDate' } }),
      },
    })

    const res = await app.request(`/api/banks/${bank.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ parserConfig: null }),
    })
    expect(res.status).toBe(200)
    const stored = await prisma.bank.findUnique({ where: { id: bank.id } })
    expect(stored?.parserConfig).toBeNull()
  })
})
