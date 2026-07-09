import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setupTestDb } from './helpers/test-db.js'
import { todayYMD, addDaysYMD, daysUntil, formatYMD } from '@bill-alarm/shared/date'
import { formatAmount } from '@bill-alarm/shared/format'

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
  await prisma.bill.deleteMany()
  await prisma.bank.deleteMany()
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

describe('sendNewBillAlert', () => {
  const MIN_PAYMENT = 3000

  async function seedBankBill(opts: { minimumPayment?: number; parseSource?: string } = {}) {
    const user = await prisma.user.create({
      data: { username: 'billowner', passwordHash: 'x:y', role: 'member', telegramChatId: '999' },
    })
    const bank = await prisma.bank.create({
      data: { name: '測試銀行', emailSenderPattern: 'x@x', emailSubjectPattern: 'b', userId: user.id },
    })
    const bill = await prisma.bill.create({
      data: {
        bankId: bank.id,
        billingPeriod: '2026-07',
        amount: 12345,
        minimumPayment: opts.minimumPayment,
        dueDate: addDaysYMD(todayYMD(), 5),
        parseSource: opts.parseSource,
      },
    })
    return { bank, bill }
  }

  it('no warning: message is byte-identical to the existing (pre-change) format', async () => {
    await setSetting(KEYS.TELEGRAM_BOT_TOKEN, 'tok')
    const { bank, bill } = await seedBankBill()
    fetchMock.mockResolvedValue(okResponse({ ok: true }))

    const r = await telegram.sendNewBillAlert(bill, bank)

    expect(r.ok).toBe(true)
    const days = daysUntil(bill.dueDate)
    const expected = [
      '<b>📨 收到新帳單</b>',
      '',
      `🏦 ${bank.name}`,
      `💰 應繳金額：${formatAmount(bill.amount)}`,
      `📅 截止日：${formatYMD(bill.dueDate)}`,
      `⏰ 還有 ${days} 天`,
    ].join('\n')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).text).toBe(expected)
  })

  it('warning: inserts the sanity-check warning line before the LLM block', async () => {
    await setSetting(KEYS.TELEGRAM_BOT_TOKEN, 'tok')
    const { bank, bill } = await seedBankBill({ minimumPayment: MIN_PAYMENT, parseSource: 'llm' })
    fetchMock.mockResolvedValue(okResponse({ ok: true }))

    const warning = '金額超出合理範圍 (600000)'
    const r = await telegram.sendNewBillAlert(bill, bank, warning)

    expect(r.ok).toBe(true)
    const days = daysUntil(bill.dueDate)
    const expected = [
      '<b>📨 收到新帳單（AI 解析）</b>',
      '',
      `🏦 ${bank.name}`,
      `💰 應繳金額：${formatAmount(bill.amount)}`,
      `📉 最低應繳：${formatAmount(MIN_PAYMENT)}`,
      `📅 截止日：${formatYMD(bill.dueDate)}`,
      `⏰ 還有 ${days} 天`,
      '',
      `⚠️ 解析結果異常（${warning}），請核對後再繳費。`,
      '',
      '🤖 此次由 AI 解析，請到帳單詳情頁核對金額。',
    ].join('\n')
    const text = JSON.parse(fetchMock.mock.calls[0][1].body).text
    expect(text).toBe(expected)
    expect(text).toContain('⚠️ 解析結果異常（金額超出合理範圍 (600000)），請核對後再繳費')
  })
})
