import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setupTestDb } from './helpers/test-db.js'

setupTestDb()
process.env.LOG_LEVEL = 'silent'

const { default: prisma } = await import('@/prisma.js')
const { setSetting, KEYS } = await import('../settings.js')
const telegram = await import('../telegram.js')
const { processReminderRules, processNewBill } = await import('../notification.js')

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

function okResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 })
}

beforeEach(async () => {
  fetchMock.mockReset()
  await prisma.notificationLog.deleteMany()
  await prisma.bill.deleteMany()
  await prisma.notificationRule.deleteMany()
  await prisma.bank.deleteMany()
  await prisma.user.deleteMany()
  await prisma.setting.deleteMany()
})

async function seedUserWithDueBill(username: string, chatId: string | null, deletedAt: Date | null = null) {
  const user = await prisma.user.create({
    data: { username, passwordHash: 'x:y', role: 'member', telegramChatId: chatId, deletedAt },
  })
  const bank = await prisma.bank.create({
    data: { name: `${username}-bank`, emailSenderPattern: 'x@x', emailSubjectPattern: 'b', userId: user.id },
  })
  const due = new Date()
  due.setHours(0, 0, 0, 0)
  due.setDate(due.getDate() + 3)
  const bill = await prisma.bill.create({
    data: { bankId: bank.id, billingPeriod: '2026-07', amount: 100, dueDate: due },
  })
  await prisma.notificationRule.create({
    data: { name: 'r', daysBefore: 3, timeOfDay: '09:00', channels: JSON.stringify(['telegram']), userId: user.id },
  })
  return { user, bank, bill }
}

describe('owner-targeted notifications', () => {
  it('sendToUser: unbound user fails gracefully with the zh-TW reason', async () => {
    await setSetting(KEYS.TELEGRAM_BOT_TOKEN, 'tok')
    const u = await prisma.user.create({ data: { username: 'nobind', passwordHash: 'x:y', role: 'member' } })
    const r = await telegram.sendToUser(u.id, 'hi')
    expect(r).toEqual({ ok: false, error: '使用者未綁定 Telegram' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reminders go only to each bill owner; deactivated owners are silent', async () => {
    await setSetting(KEYS.TELEGRAM_BOT_TOKEN, 'tok')
    await seedUserWithDueBill('alice', '111')
    await seedUserWithDueBill('bob', '222')
    await seedUserWithDueBill('gone', '333', new Date())
    fetchMock.mockResolvedValue(okResponse({ ok: true }))

    await processReminderRules()

    const sentChatIds = fetchMock.mock.calls.map(call => JSON.parse(call[1].body).chat_id).sort()
    expect(sentChatIds).toEqual(['111', '222']) // no 333
    const logs = await prisma.notificationLog.findMany()
    expect(logs).toHaveLength(2) // deactivated: no log row either
    expect(logs.every(l => l.success)).toBe(true)
  })

  it('owner without binding gets a failed log row', async () => {
    await setSetting(KEYS.TELEGRAM_BOT_TOKEN, 'tok')
    await seedUserWithDueBill('carol', null)
    await processReminderRules()
    const logs = await prisma.notificationLog.findMany()
    expect(logs).toHaveLength(1)
    expect(logs[0].success).toBe(false)
    expect(logs[0].errorMessage).toContain('使用者未綁定 Telegram')
  })

  it('processNewBill: deactivated owner is silent — no send, no log', async () => {
    await setSetting(KEYS.TELEGRAM_BOT_TOKEN, 'tok')
    const { bank, bill } = await seedUserWithDueBill('gone-new', '444', new Date())

    await processNewBill(bill, bank)

    expect(fetchMock).not.toHaveBeenCalled()
    expect(await prisma.notificationLog.count({ where: { billId: bill.id } })).toBe(0)
  })
})
