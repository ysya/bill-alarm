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
})

describe('broadcast', () => {
  it('sends to all bound users, deduplicating chat ids', async () => {
    await setSetting(KEYS.TELEGRAM_BOT_TOKEN, 'tok')
    await prisma.user.createMany({
      data: [
        { username: 'a', passwordHash: 'x:y', role: 'admin', telegramChatId: '111' },
        { username: 'b', passwordHash: 'x:y', role: 'member', telegramChatId: '222' },
        { username: 'c', passwordHash: 'x:y', role: 'member', telegramChatId: '111' }, // same group as a
        { username: 'd', passwordHash: 'x:y', role: 'member' }, // unbound
      ],
    })
    fetchMock.mockResolvedValue(okResponse({ ok: true }))

    const result = await telegram.broadcast('hello')
    expect(result).toEqual({ ok: true, sent: 2, failed: 0, errors: [] })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const sentChatIds = fetchMock.mock.calls.map(call => JSON.parse(call[1].body).chat_id).sort()
    expect(sentChatIds).toEqual(['111', '222'])
  })

  it('partial failure: still ok=true, failure recorded', async () => {
    await setSetting(KEYS.TELEGRAM_BOT_TOKEN, 'tok')
    await prisma.user.createMany({
      data: [
        { username: 'a', passwordHash: 'x:y', role: 'admin', telegramChatId: '111' },
        { username: 'b', passwordHash: 'x:y', role: 'member', telegramChatId: '222' },
      ],
    })
    fetchMock
      .mockResolvedValueOnce(okResponse({ ok: true }))
      .mockResolvedValueOnce(new Response('chat not found', { status: 400 }))

    const result = await telegram.broadcast('hello')
    expect(result.ok).toBe(true)
    expect(result.sent).toBe(1)
    expect(result.failed).toBe(1)
    expect(result.errors).toHaveLength(1)
  })

  it('no bound users → ok=false, no fetch', async () => {
    await setSetting(KEYS.TELEGRAM_BOT_TOKEN, 'tok')
    const result = await telegram.broadcast('hello')
    expect(result.ok).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
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
