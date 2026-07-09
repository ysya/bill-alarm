import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setupTestDb } from '../../services/__tests__/helpers/test-db.js'

setupTestDb()
process.env.LOG_LEVEL = 'silent'

const { default: app } = await import('@/index.js')
const { default: prisma } = await import('@/prisma.js')
const { setSetting, KEYS } = await import('@/services/settings.js')
const { _resetTelegramCaches } = await import('@/services/telegram.js')
const { _resetBindCodes } = await import('@/services/telegram-binding.js')
const { hashPassword } = await import('@/services/auth.js')

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

function okResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 })
}

function cookieOf(res: Response): string {
  return res.headers.get('set-cookie')?.split(';')[0] ?? ''
}

const setup = await app.request('/api/auth/setup', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'boss', password: 'admin-password' }),
})
const cookie = cookieOf(setup)

beforeEach(() => {
  fetchMock.mockReset()
  _resetTelegramCaches()
  _resetBindCodes()
})

describe('telegram binding', () => {
  it('bind without bot token → 400', async () => {
    const res = await app.request('/api/auth/telegram/bind', { method: 'POST', headers: { Cookie: cookie } })
    expect(res.status).toBe(400)
  })

  it('bind → deep link; confirm matches /start <code> and stores chat id; unbind clears it', async () => {
    await setSetting(KEYS.TELEGRAM_BOT_TOKEN, 'tok')
    fetchMock.mockResolvedValueOnce(okResponse({ ok: true, result: { username: 'BillAlarmBot' } })) // getMe

    const bind = await app.request('/api/auth/telegram/bind', { method: 'POST', headers: { Cookie: cookie } })
    expect(bind.status).toBe(200)
    const { deepLink } = await bind.json()
    expect(deepLink).toMatch(/^https:\/\/t\.me\/BillAlarmBot\?start=[0-9a-f]{16}$/)
    const code = deepLink.split('start=')[1]

    fetchMock.mockResolvedValueOnce(okResponse({
      ok: true,
      result: [
        { update_id: 1, message: { text: 'hello', chat: { id: 5 } } },
        { update_id: 2, message: { text: `/start ${code}`, chat: { id: 424242 } } },
      ],
    })) // getUpdates
    const confirm = await app.request('/api/auth/telegram/confirm', { method: 'POST', headers: { Cookie: cookie } })
    expect(confirm.status).toBe(200)

    const user = await prisma.user.findUnique({ where: { username: 'boss' } })
    expect(user!.telegramChatId).toBe('424242')

    const me = await app.request('/api/auth/me', { headers: { Cookie: cookie } })
    expect((await me.json()).telegramBound).toBe(true)

    const unbind = await app.request('/api/auth/telegram', { method: 'DELETE', headers: { Cookie: cookie } })
    expect(unbind.status).toBe(200)
    const after = await prisma.user.findUnique({ where: { username: 'boss' } })
    expect(after!.telegramChatId).toBeNull()
  })

  it('confirm without a Start message → 404; confirm without an outstanding code → 410', async () => {
    await setSetting(KEYS.TELEGRAM_BOT_TOKEN, 'tok')
    fetchMock.mockResolvedValueOnce(okResponse({ ok: true, result: { username: 'BillAlarmBot' } }))
    await app.request('/api/auth/telegram/bind', { method: 'POST', headers: { Cookie: cookie } })

    fetchMock.mockResolvedValueOnce(okResponse({ ok: true, result: [] })) // getUpdates: nothing yet
    const notSeen = await app.request('/api/auth/telegram/confirm', { method: 'POST', headers: { Cookie: cookie } })
    expect(notSeen.status).toBe(404)

    _resetBindCodes()
    const noCode = await app.request('/api/auth/telegram/confirm', { method: 'POST', headers: { Cookie: cookie } })
    expect(noCode.status).toBe(410)
  })

  it('a consumed code cannot be replayed even while the old /start is still in the backlog', async () => {
    await setSetting(KEYS.TELEGRAM_BOT_TOKEN, 'tok')
    fetchMock.mockResolvedValueOnce(okResponse({ ok: true, result: { username: 'BillAlarmBot' } })) // getMe
    const bind = await app.request('/api/auth/telegram/bind', { method: 'POST', headers: { Cookie: cookie } })
    const code = (await bind.json()).deepLink.split('start=')[1]

    const backlog = okResponse({
      ok: true,
      result: [{ update_id: 1, message: { text: `/start ${code}`, chat: { id: 111 } } }],
    })
    fetchMock.mockResolvedValueOnce(backlog)
    expect((await app.request('/api/auth/telegram/confirm', { method: 'POST', headers: { Cookie: cookie } })).status).toBe(200)

    // Telegram keeps undelivered updates for 24h (we never commit offsets) —
    // a second confirm with the same backlog must be 410, not a re-bind.
    fetchMock.mockResolvedValueOnce(okResponse({
      ok: true,
      result: [{ update_id: 1, message: { text: `/start ${code}`, chat: { id: 999 } } }],
    }))
    expect((await app.request('/api/auth/telegram/confirm', { method: 'POST', headers: { Cookie: cookie } })).status).toBe(410)
    const user = await prisma.user.findUnique({ where: { username: 'boss' } })
    expect(user!.telegramChatId).toBe('111')
  })

  it('two users with outstanding codes never bind each other chat id', async () => {
    await setSetting(KEYS.TELEGRAM_BOT_TOKEN, 'tok')
    await prisma.user.create({
      data: { username: 'kid', passwordHash: await hashPassword('member-password'), role: 'member' },
    })
    const login = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'kid', password: 'member-password' }),
    })
    const kidCookie = cookieOf(login)

    fetchMock.mockResolvedValueOnce(okResponse({ ok: true, result: { username: 'BillAlarmBot' } })) // getMe (cached after)
    const bindBoss = await app.request('/api/auth/telegram/bind', { method: 'POST', headers: { Cookie: cookie } })
    const codeBoss = (await bindBoss.json()).deepLink.split('start=')[1]
    const bindKid = await app.request('/api/auth/telegram/bind', { method: 'POST', headers: { Cookie: kidCookie } })
    const codeKid = (await bindKid.json()).deepLink.split('start=')[1]

    // One shared backlog containing BOTH /start messages (real Telegram: one bot, one stream)
    const backlog = () => okResponse({
      ok: true,
      result: [
        { update_id: 10, message: { text: `/start ${codeBoss}`, chat: { id: 1111 } } },
        { update_id: 11, message: { text: `/start ${codeKid}`, chat: { id: 2222 } } },
      ],
    })
    fetchMock.mockResolvedValueOnce(backlog())
    expect((await app.request('/api/auth/telegram/confirm', { method: 'POST', headers: { Cookie: cookie } })).status).toBe(200)
    fetchMock.mockResolvedValueOnce(backlog())
    expect((await app.request('/api/auth/telegram/confirm', { method: 'POST', headers: { Cookie: kidCookie } })).status).toBe(200)

    const boss = await prisma.user.findUnique({ where: { username: 'boss' } })
    const kid = await prisma.user.findUnique({ where: { username: 'kid' } })
    expect(boss!.telegramChatId).toBe('1111')
    expect(kid!.telegramChatId).toBe('2222')
  })
})
