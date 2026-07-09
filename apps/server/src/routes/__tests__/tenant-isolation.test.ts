import { describe, it, expect } from 'vitest'
import { setupTestDb } from '../../services/__tests__/helpers/test-db.js'
import { todayYMD } from '@bill-alarm/shared/date'

setupTestDb()
process.env.LOG_LEVEL = 'silent'

const { default: app } = await import('@/index.js')
const { default: prisma } = await import('@/prisma.js')

function cookieOf(res: Response): string {
  return res.headers.get('set-cookie')?.split(';')[0] ?? ''
}

async function json(method: string, path: string, cookie: string, body?: unknown): Promise<Response> {
  return app.request(path, {
    method,
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

// Bootstrap: admin via /setup, member via users API, both logged in.
const setup = await app.request('/api/auth/setup', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'boss', password: 'admin-password' }),
})
const boss = cookieOf(setup)
await json('POST', '/api/users', boss, { username: 'kid', password: 'member-password' })
const kidLogin = await app.request('/api/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'kid', password: 'member-password' }),
})
const kid = cookieOf(kidLogin)

describe('tenant isolation — banks / accounts / rules / scan logs', () => {
  it('banks: same preset enable coexists per user; lists are disjoint; foreign bank ids 404', async () => {
    const b1 = await json('POST', '/api/banks/enable/esun', boss, {})
    expect(b1.status).toBe(201)
    const b2 = await json('POST', '/api/banks/enable/esun', kid, {})
    expect(b2.status).toBe(201) // would violate the old global code unique

    const bossList = await (await json('GET', '/api/banks', boss)).json()
    const kidList = await (await json('GET', '/api/banks', kid)).json()
    expect(bossList).toHaveLength(1)
    expect(kidList).toHaveLength(1)
    expect(bossList[0].id).not.toBe(kidList[0].id)
    // pdfPassword is masked out of the list response even for your own rows (B8);
    // hasPdfPassword reflects whether one is set instead.
    expect('pdfPassword' in bossList[0]).toBe(false)
    expect(bossList[0].hasPdfPassword).toBe(false) // enabled without a password above

    const foreign = await json('PATCH', `/api/banks/${bossList[0].id}`, kid, { name: 'hax' })
    expect(foreign.status).toBe(404)
    expect((await json('POST', '/api/banks/disable/esun', kid)).status).toBe(200) // own copy
    const bossAfter = await (await json('GET', '/api/banks', boss)).json()
    expect(bossAfter[0].isActive).toBe(true) // kid's disable didn't touch boss's bank
  })

  it('bank accounts: scoped CRUD, foreign 404', async () => {
    const created = await json('POST', '/api/bank-accounts', boss, { name: '薪轉', bankName: '玉山' })
    expect(created.status).toBe(201)
    const acc = await created.json()
    expect((await (await json('GET', '/api/bank-accounts', kid)).json())).toHaveLength(0)
    expect((await json('PATCH', `/api/bank-accounts/${acc.id}`, kid, { name: 'x' })).status).toBe(404)
    expect((await json('DELETE', `/api/bank-accounts/${acc.id}`, kid)).status).toBe(404)
  })

  it('notification rules: scoped CRUD, foreign 404', async () => {
    const created = await json('POST', '/api/notification-rules', boss, {
      name: '提前三天', daysBefore: 3, timeOfDay: '09:00', channels: ['telegram'],
    })
    expect(created.status).toBe(201)
    const rule = await created.json()
    expect(await (await json('GET', '/api/notification-rules', kid)).json()).toHaveLength(0)
    expect((await json('PATCH', `/api/notification-rules/${rule.id}`, kid, { name: 'x' })).status).toBe(404)
    expect((await json('DELETE', `/api/notification-rules/${rule.id}`, kid)).status).toBe(404)
  })

  it('scan logs: each user sees only their own', async () => {
    const bossUser = await prisma.user.findUnique({ where: { username: 'boss' } })
    await prisma.scanLog.create({ data: { trigger: 'manual', userId: bossUser!.id } })
    const kidLogs = await (await json('GET', '/api/scan-logs', kid)).json()
    expect(kidLogs.logs).toHaveLength(0)
    const bossLogs = await (await json('GET', '/api/scan-logs', boss)).json()
    expect(bossLogs.logs).toHaveLength(1)
  })
})

describe('tenant isolation — bills', () => {
  let bossBillId = ''

  it('setup: a bill under boss\'s bank', async () => {
    const bossUser = await prisma.user.findUnique({ where: { username: 'boss' } })
    const bank = await prisma.bank.create({
      data: { name: 'B-Bank', emailSenderPattern: 'b@b', emailSubjectPattern: 'bill', userId: bossUser!.id },
    })
    const bill = await prisma.bill.create({
      data: { bankId: bank.id, billingPeriod: '2026-07', amount: 1234, dueDate: todayYMD() },
    })
    bossBillId = bill.id
    expect(bossBillId).toBeTruthy()
  })

  it('lists and summary are per-user', async () => {
    const bossList = await (await json('GET', '/api/bills', boss)).json()
    expect(bossList.data.some((b: any) => b.id === bossBillId)).toBe(true)
    const kidList = await (await json('GET', '/api/bills', kid)).json()
    expect(kidList.data).toHaveLength(0)
    const kidSummary = await (await json('GET', '/api/bills/summary', kid)).json()
    expect(kidSummary.pendingCount).toBe(0)
  })

  it('every single-bill endpoint 404s for a foreign bill', async () => {
    const cases: Array<[string, string, unknown?]> = [
      ['GET', `/api/bills/${bossBillId}`],
      ['GET', `/api/bills/${bossBillId}/pdf`],
      ['PATCH', `/api/bills/${bossBillId}`, { amount: 1 }],
      ['PATCH', `/api/bills/${bossBillId}/pay`, {}],
      ['POST', `/api/bills/${bossBillId}/unpay`],
      ['POST', `/api/bills/${bossBillId}/reparse`],
      ['DELETE', `/api/bills/${bossBillId}`],
      ['GET', `/api/parser/bootstrap/${bossBillId}`],
    ]
    for (const [method, path, body] of cases) {
      const res = await json(method, path, kid, body)
      expect(res.status, `${method} ${path}`).toBe(404)
    }
    // owner still passes
    expect((await json('GET', `/api/bills/${bossBillId}`, boss)).status).toBe(200)
  })
})
