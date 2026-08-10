import { describe, it, expect } from 'vitest'
import { setupTestDb } from '../../services/__tests__/helpers/test-db.js'

setupTestDb()
process.env.LOG_LEVEL = 'silent'

const { default: app } = await import('@/index.js')
const { default: prisma } = await import('@/prisma.js')
const { setSetting, KEYS } = await import('@/services/settings.js')

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

async function statusFor(cookie: string) {
  const res = await json('GET', '/api/onboarding-status', cookie)
  expect(res.status).toBe(200)
  return res.json()
}

describe('onboarding-status', () => {
  it('fresh user: everything false', async () => {
    expect(await statusFor(boss)).toEqual({
      emailConfigured: false,
      hasActiveBank: false,
      botConfigured: false,
      telegramBound: false,
    })
  })

  it('each flag flips independently and is self-scoped', async () => {
    const bossUser = await prisma.user.findUnique({ where: { username: 'boss' } })

    // email: needs BOTH user and password
    await prisma.user.update({ where: { id: bossUser!.id }, data: { imapUser: 'a@b.c' } })
    expect((await statusFor(boss)).emailConfigured).toBe(false)
    await prisma.user.update({ where: { id: bossUser!.id }, data: { imapPassword: 'pw' } })
    expect((await statusFor(boss)).emailConfigured).toBe(true)

    // bank: an inactive bank does not count; boss's bank does not leak to kid
    const bank = await prisma.bank.create({
      data: { name: 'b', emailSenderPattern: 'x@x', emailSubjectPattern: 's', userId: bossUser!.id, isActive: false },
    })
    expect((await statusFor(boss)).hasActiveBank).toBe(false)
    await prisma.bank.update({ where: { id: bank.id }, data: { isActive: true } })
    expect((await statusFor(boss)).hasActiveBank).toBe(true)
    expect((await statusFor(kid)).hasActiveBank).toBe(false)

    // bot: a system-wide setting, visible to members too
    expect((await statusFor(kid)).botConfigured).toBe(false)
    await setSetting(KEYS.TELEGRAM_BOT_TOKEN, 'tok')
    expect((await statusFor(kid)).botConfigured).toBe(true)

    // binding: per user
    await prisma.user.update({ where: { id: bossUser!.id }, data: { telegramChatId: '111' } })
    expect((await statusFor(boss)).telegramBound).toBe(true)
    expect((await statusFor(kid)).telegramBound).toBe(false)
  })
})
