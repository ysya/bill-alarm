import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setupTestDb } from '../../services/__tests__/helpers/test-db.js'

setupTestDb()
process.env.LOG_LEVEL = 'silent'

const { default: app } = await import('@/index.js')
const { default: prisma } = await import('@/prisma.js')
const { setSetting, KEYS } = await import('@/services/settings.js')
const { _resetTelegramCaches } = await import('@/services/telegram.js')
const { _resetBindCodes } = await import('@/services/telegram-binding.js')

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
})
