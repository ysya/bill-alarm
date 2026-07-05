import { describe, it, expect } from 'vitest'
import { setupTestDb } from '../../services/__tests__/helpers/test-db.js'

setupTestDb()
process.env.LOG_LEVEL = 'silent'

const { default: app } = await import('@/index.js')
const { default: prisma } = await import('@/prisma.js')
const { hashPassword } = await import('@/services/auth.js')

function cookieOf(res: Response): string {
  return res.headers.get('set-cookie')?.split(';')[0] ?? ''
}

async function loginAs(username: string, password: string): Promise<string> {
  const res = await app.request('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  expect(res.status).toBe(200)
  return cookieOf(res)
}

// Bootstrap: admin via /setup, member directly in the DB.
const setup = await app.request('/api/auth/setup', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'boss', password: 'admin-password' }),
})
if (setup.status !== 200) throw new Error('setup failed')
await prisma.user.create({
  data: { username: 'kid', passwordHash: hashPassword('member-password'), role: 'member' },
})

describe('member allow-list', () => {
  it('member can read bills, banks, scan logs, statuses, calendar info, and self auth', async () => {
    const cookie = await loginAs('kid', 'member-password')
    for (const path of ['/api/bills', '/api/bills/summary', '/api/banks', '/api/scan-logs', '/api/integrations/status', '/api/calendar/info', '/api/auth/me']) {
      const res = await app.request(path, { headers: { Cookie: cookie } })
      expect(res.status, path).not.toBe(403)
      expect(res.status, path).not.toBe(401)
    }
  })

  it('member can mark paid and unpay', async () => {
    const cookie = await loginAs('kid', 'member-password')
    const bank = await prisma.bank.create({
      data: { name: 'T-Bank', emailSenderPattern: 'x@x', emailSubjectPattern: 'bill', pdfPassword: 'A123456789' },
    })
    const bill = await prisma.bill.create({
      data: { bankId: bank.id, billingPeriod: '2026-06', amount: 100, dueDate: new Date() },
    })
    const pay = await app.request(`/api/bills/${bill.id}/pay`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({}),
    })
    expect(pay.status).toBe(200)
    const unpay = await app.request(`/api/bills/${bill.id}/unpay`, {
      method: 'POST', headers: { Cookie: cookie },
    })
    expect(unpay.status).toBe(200)
    const after = await prisma.bill.findUnique({ where: { id: bill.id } })
    expect(after!.status).toBe('pending')
    expect(after!.paidAt).toBeNull()

    // pin the per-bill GETs the allow-list must keep open
    const detail = await app.request(`/api/bills/${bill.id}`, { headers: { Cookie: cookie } })
    expect(detail.status).toBe(200)
    const detailBody = await detail.json()
    expect(detailBody.bank).not.toHaveProperty('pdfPassword')

    // member bill list must not leak the embedded bank's pdfPassword either
    const list = await app.request('/api/bills', { headers: { Cookie: cookie } })
    expect(list.status).toBe(200)
    const listBody = await list.json()
    const listedBill = listBody.data.find((b: { id: string }) => b.id === bill.id)
    expect(listedBill.bank).not.toHaveProperty('pdfPassword')

    // member GET /api/banks must strip pdfPassword; admin keeps it
    const memberBanks = await app.request('/api/banks', { headers: { Cookie: cookie } })
    expect(memberBanks.status).toBe(200)
    const memberBanksBody = await memberBanks.json()
    const memberBankEntry = memberBanksBody.find((b: { id: string }) => b.id === bank.id)
    expect(memberBankEntry).not.toHaveProperty('pdfPassword')

    const adminCookie = await loginAs('boss', 'admin-password')
    const adminBanks = await app.request('/api/banks', { headers: { Cookie: adminCookie } })
    expect(adminBanks.status).toBe(200)
    const adminBanksBody = await adminBanks.json()
    const adminBankEntry = adminBanksBody.find((b: { id: string }) => b.id === bank.id)
    expect(adminBankEntry.pdfPassword).toBe('A123456789')

    const pdf = await app.request(`/api/bills/${bill.id}/pdf`, { headers: { Cookie: cookie } })
    expect(pdf.status).not.toBe(403) // 404 is fine (no pdf on this bill); 403 would mean the allow-list regressed

    const unpayMissing = await app.request('/api/bills/nonexistent-id/unpay', {
      method: 'POST', headers: { Cookie: cookie },
    })
    expect(unpayMissing.status).toBe(404)
  })

  it('member gets 403 on admin-only routes', async () => {
    const cookie = await loginAs('kid', 'member-password')
    const cases: Array<[string, string]> = [
      ['GET', '/api/users'],
      ['POST', '/api/banks'],
      ['PATCH', '/api/bills/some-id'],
      ['DELETE', '/api/bills/some-id'],
      ['POST', '/api/bills/some-id/reparse'],
      ['GET', '/api/config/status'],
      ['POST', '/api/config/telegram'],
      ['GET', '/api/notification-rules'],
      ['POST', '/api/email/save'],
      ['POST', '/api/calendar/rotate'],
      ['POST', '/api/telegram/test'],
    ]
    for (const [method, path] of cases) {
      const res = await app.request(path, {
        method,
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: method === 'GET' ? undefined : JSON.stringify({}),
      })
      expect(res.status, `${method} ${path}`).toBe(403)
    }
  })

  it('admin passes everywhere members are blocked', async () => {
    const cookie = await loginAs('boss', 'admin-password')
    const res = await app.request('/api/notification-rules', { headers: { Cookie: cookie } })
    expect(res.status).toBe(200)
  })
})
