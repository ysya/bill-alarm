import { describe, it, expect } from 'vitest'
import { setupTestDb } from '../../services/__tests__/helpers/test-db.js'

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
    // own rows carry own secrets (no stripping of your own data)
    expect('pdfPassword' in bossList[0]).toBe(true)

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
