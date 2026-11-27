import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setupTestDb } from './helpers/test-db.js'
import { todayYMD, addDaysYMD } from '@bill-alarm/shared/date'
import { formatAmount } from '@bill-alarm/shared/format'

setupTestDb()
process.env.LOG_LEVEL = 'silent'

const { default: prisma } = await import('@/prisma.js')
const { setSetting, KEYS } = await import('../settings.js')
const telegram = await import('../telegram.js')
const { processReminders, processNewBill, processOverdueBills } = await import('../notification.js')

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

// processReminders gates on now's HH:mm vs the user's remindTime (default
// '09:00'), so a bare call would depend on when the suite runs. Seed data and
// the injected tick derive from ONE base Date, so these tests pass at any
// wall-clock time and in any timezone (and can't disagree across midnight).
const base = new Date()

function at(h: number, m: number): Date {
  const d = new Date(base)
  d.setHours(h, m, 0, 0)
  return d
}

function okResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 })
}

beforeEach(async () => {
  fetchMock.mockReset()
  await prisma.notificationLog.deleteMany()
  await prisma.bill.deleteMany()
  await prisma.notificationPreference.deleteMany()
  await prisma.bank.deleteMany()
  await prisma.user.deleteMany()
  await prisma.setting.deleteMany()
})

// No prefs row is seeded: the shared defaults ([3,1] at 09:00) cover the
// D-3 bill below, which is exactly the zero-config path new users hit.
async function seedUserWithDueBill(username: string, chatId: string | null, deletedAt: Date | null = null) {
  const user = await prisma.user.create({
    data: { username, passwordHash: 'x:y', role: 'member', telegramChatId: chatId, deletedAt },
  })
  const bank = await prisma.bank.create({
    data: { name: `${username}-bank`, emailSenderPattern: 'x@x', emailSubjectPattern: 'b', userId: user.id },
  })
  const bill = await prisma.bill.create({
    data: { bankId: bank.id, billingPeriod: '2026-07', amount: 100, dueDate: addDaysYMD(todayYMD(base), 3) },
  })
  return { user, bank, bill }
}

describe('owner-targeted notifications', () => {
  it('sendToUser: unbound user fails gracefully with the zh-TW reason', async () => {
    await setSetting(KEYS.TELEGRAM_BOT_TOKEN, 'tok')
    const u = await prisma.user.create({ data: { username: 'nobind', passwordHash: 'x:y', role: 'member' } })
    const r = await telegram.sendToUser(u.id, 'hi')
    expect(r).toEqual({ ok: false, unavailable: true, error: '使用者未綁定 Telegram' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reminders go only to each bill owner; deactivated owners are silent', async () => {
    await setSetting(KEYS.TELEGRAM_BOT_TOKEN, 'tok')
    await seedUserWithDueBill('alice', '111')
    await seedUserWithDueBill('bob', '222')
    await seedUserWithDueBill('gone', '333', new Date())
    fetchMock.mockResolvedValue(okResponse({ ok: true }))

    await processReminders(at(12, 0)) // past the default 09:00 fire time

    const sentChatIds = fetchMock.mock.calls.map(call => JSON.parse(call[1].body).chat_id).sort()
    expect(sentChatIds).toEqual(['111', '222']) // no 333
    const logs = await prisma.notificationLog.findMany()
    expect(logs).toHaveLength(2) // deactivated: no log row either
    expect(logs.every(l => l.success)).toBe(true)
  })

  it('owner without binding gets a failed log row', async () => {
    await setSetting(KEYS.TELEGRAM_BOT_TOKEN, 'tok')
    await seedUserWithDueBill('carol', null)
    await processReminders(at(12, 0)) // past the default 09:00 fire time
    const logs = await prisma.notificationLog.findMany()
    expect(logs).toHaveLength(1)
    expect(logs[0].success).toBe(false)
    expect(logs[0].errorMessage).toContain('使用者未綁定 Telegram')
  })

  it('links the bound owner to the exact bill for manual debit confirmation', async () => {
    await setSetting(KEYS.TELEGRAM_BOT_TOKEN, 'tok')
    vi.stubEnv('APP_BASE_URL', 'https://bills.example.org/')
    try {
      const { user, bill } = await seedUserWithDueBill('debit', '333')
      await prisma.bill.update({ where: { id: bill.id }, data: {
        dueDate: addDaysYMD(todayYMD(base), -1), transferredAt: base, transferredAmount: bill.amount,
      } })
      await prisma.notificationPreference.create({ data: { userId: user.id, notifyDebitConfirmation: true } })
      fetchMock.mockResolvedValue(okResponse({ ok: true }))
      await processOverdueBills(at(9, 15))
      expect(fetchMock).toHaveBeenCalledTimes(1)
      const payload = JSON.parse(fetchMock.mock.calls[0][1].body)
      expect(payload.chat_id).toBe('333')
      expect(payload.text).toContain(`<a href="https://bills.example.org/bills/${bill.id}">開啟帳單明細</a>`)
      expect(payload.text).toContain('核對銀行紀錄')
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('pre-deadline reminders for a partially funded bill show the remaining amount', async () => {
    await setSetting(KEYS.TELEGRAM_BOT_TOKEN, 'tok')
    const { bank, bill } = await seedUserWithDueBill('shortfall', '555')
    await prisma.bank.update({ where: { id: bank.id }, data: { autoDebit: true } })
    await prisma.bill.update({ where: { id: bill.id }, data: { transferredAt: base, transferredAmount: 60 } })
    fetchMock.mockResolvedValue(okResponse({ ok: true }))
    await processReminders(at(9, 15))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).text).toContain(`尚需備款 ${formatAmount(40)}`)
  })

  it('skips Telegram without a bot or bound owner while retaining eligibility once both are available', async () => {
    const { user, bill } = await seedUserWithDueBill('calendar-only', null)
    await prisma.bill.update({ where: { id: bill.id }, data: {
      dueDate: addDaysYMD(todayYMD(base), -1), transferredAt: base, transferredAmount: bill.amount,
    } })
    await prisma.notificationPreference.create({ data: { userId: user.id, notifyDebitConfirmation: true } })
    vi.stubEnv('TELEGRAM_BOT_TOKEN', '')
    try {
      await processOverdueBills(at(9, 0))
      await setSetting(KEYS.TELEGRAM_BOT_TOKEN, 'tok')
      await processOverdueBills(at(9, 15))
      expect(fetchMock).not.toHaveBeenCalled()
      expect(await prisma.notificationLog.count()).toBe(0)

      await prisma.user.update({ where: { id: user.id }, data: { telegramChatId: '222' } })
      fetchMock.mockResolvedValue(okResponse({ ok: true }))
      await processOverdueBills(at(9, 30))
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(await prisma.notificationLog.count()).toBe(1)
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('processNewBill: deactivated owner is silent — no send, no log', async () => {
    await setSetting(KEYS.TELEGRAM_BOT_TOKEN, 'tok')
    const { bank, bill } = await seedUserWithDueBill('gone-new', '444', new Date())

    await processNewBill(bill, bank)

    expect(fetchMock).not.toHaveBeenCalled()
    expect(await prisma.notificationLog.count({ where: { billId: bill.id } })).toBe(0)
  })

  it('processNewBill: owner with notifyNewBill=false is skipped — no send, no log', async () => {
    await setSetting(KEYS.TELEGRAM_BOT_TOKEN, 'tok')
    const { user, bank, bill } = await seedUserWithDueBill('optout', '555')
    await prisma.notificationPreference.create({ data: { userId: user.id, notifyNewBill: false } })

    await processNewBill(bill, bank)

    expect(fetchMock).not.toHaveBeenCalled()
    expect(await prisma.notificationLog.count({ where: { billId: bill.id } })).toBe(0)
  })
})
