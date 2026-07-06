import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setupTestDb } from './helpers/test-db.js'

setupTestDb()

const { default: prisma } = await import('@/prisma.js')
const { setSetting, KEYS } = await import('../settings.js')
const telegram = await import('../telegram.js')

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

function okResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 })
}

beforeEach(async () => {
  fetchMock.mockReset()
  telegram._resetTelegramCaches()
  await prisma.user.deleteMany()
  await prisma.setting.deleteMany()
})

describe('sendToUser', () => {
  it("sends to the user's own chat id", async () => {
    await setSetting(KEYS.TELEGRAM_BOT_TOKEN, 'tok')
    const u = await prisma.user.create({
      data: { username: 'bound', passwordHash: 'x:y', role: 'member', telegramChatId: '777' },
    })
    fetchMock.mockResolvedValue(okResponse({ ok: true }))
    const r = await telegram.sendToUser(u.id, 'hello')
    expect(r.ok).toBe(true)
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).chat_id).toBe('777')
  })
})

describe('getBotUsername', () => {
  it('caches getMe across calls', async () => {
    await setSetting(KEYS.TELEGRAM_BOT_TOKEN, 'tok')
    fetchMock.mockResolvedValue(okResponse({ ok: true, result: { username: 'BillAlarmBot' } }))
    expect(await telegram.getBotUsername()).toBe('BillAlarmBot')
    expect(await telegram.getBotUsername()).toBe('BillAlarmBot')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
