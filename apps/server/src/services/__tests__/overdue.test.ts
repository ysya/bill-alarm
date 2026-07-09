import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setupTestDb } from './helpers/test-db.js'
import { todayYMD, addDaysYMD } from '@bill-alarm/shared/date'
import { BillStatus } from '@bill-alarm/shared/types'

setupTestDb()
process.env.LOG_LEVEL = 'silent'

vi.mock('@/services/telegram.js', () => ({
  sendOverdueWarning: vi.fn(async () => ({ ok: true })),
}))

const { default: prisma } = await import('@/prisma.js')
const { sendOverdueWarning } = await import('../telegram.js')
const { processOverdueBills, OVERDUE_WARNING_MESSAGE } = await import('../notification.js')

// Single "now" base for the whole file: all test data (dueDate) and all tick
// times are derived from this one Date, so the suite can't flake if the wall
// clock happens to cross midnight while the tests run.
const base = new Date()

function at(h: number, m: number): Date {
  const d = new Date(base)
  d.setHours(h, m, 0, 0)
  return d
}

let billSeq = 0

beforeEach(async () => {
  // NOT clearAllMocks: resetAllMocks restores vi.fn(impl)'s factory
  // implementation (Vitest 4 semantics), so sendOverdueWarning goes back to
  // resolving { ok: true } for every test without a manual re-stub.
  vi.resetAllMocks()
  billSeq = 0
  await prisma.notificationLog.deleteMany()
  await prisma.bill.deleteMany()
  await prisma.bank.deleteMany()
  await prisma.user.deleteMany()
})

async function seedUser(username: string, chatId: string | null = '111', deletedAt: Date | null = null) {
  const user = await prisma.user.create({
    data: { username, passwordHash: 'x:y', role: 'member', telegramChatId: chatId, deletedAt },
  })
  const bank = await prisma.bank.create({
    data: { name: `${username}-bank`, emailSenderPattern: 'x@x', emailSubjectPattern: 'b', userId: user.id },
  })
  return { user, bank }
}

async function seedBill(bankId: string, dueDate: string, status: BillStatus = BillStatus.PENDING) {
  billSeq += 1
  return prisma.bill.create({
    data: { bankId, billingPeriod: `p${billSeq}`, amount: 100, dueDate, status },
  })
}

describe('processOverdueBills: mark every tick, notify once after 09:00', () => {
  it('case 1: a tick before 09:00 marks the bill overdue but does not notify', async () => {
    const { bank } = await seedUser('alice')
    const bill = await seedBill(bank.id, addDaysYMD(todayYMD(base), -1))

    await processOverdueBills(at(0, 10))

    expect((await prisma.bill.findUniqueOrThrow({ where: { id: bill.id } })).status).toBe(BillStatus.OVERDUE)
    expect(sendOverdueWarning).not.toHaveBeenCalled()
    expect(await prisma.notificationLog.count()).toBe(0)
  })

  it('case 2: the first tick at/after 09:00 marks and sends once', async () => {
    const { bank } = await seedUser('alice')
    const bill = await seedBill(bank.id, addDaysYMD(todayYMD(base), -1))

    await processOverdueBills(at(9, 10))

    expect((await prisma.bill.findUniqueOrThrow({ where: { id: bill.id } })).status).toBe(BillStatus.OVERDUE)
    expect(sendOverdueWarning).toHaveBeenCalledTimes(1)
    const logs = await prisma.notificationLog.findMany()
    expect(logs).toHaveLength(1)
    expect(logs[0].message).toBe(OVERDUE_WARNING_MESSAGE)
    expect(logs[0].channel).toBe('telegram')
    expect(logs[0].ruleId).toBeNull()
    expect(logs[0].success).toBe(true)
  })

  it('a bill marked overdue on an earlier tick is notified on the first tick at/after 09:00', async () => {
    const { bank } = await seedUser('alice')
    const bill = await seedBill(bank.id, addDaysYMD(todayYMD(base), -1))

    await processOverdueBills(at(0, 10)) // earlier tick: marks only
    expect(sendOverdueWarning).not.toHaveBeenCalled()
    expect((await prisma.bill.findUniqueOrThrow({ where: { id: bill.id } })).status).toBe(BillStatus.OVERDUE)

    await processOverdueBills(at(9, 10)) // first post-09:00 tick: notifies
    expect(sendOverdueWarning).toHaveBeenCalledTimes(1)
  })

  it('case 3: a later tick the same day does not re-notify (NotificationLog dedup)', async () => {
    const { bank } = await seedUser('alice')
    await seedBill(bank.id, addDaysYMD(todayYMD(base), -1))

    await processOverdueBills(at(9, 10))
    await processOverdueBills(at(9, 25))

    expect(sendOverdueWarning).toHaveBeenCalledTimes(1)
    expect(await prisma.notificationLog.count()).toBe(1)
  })

  it('case 4: a deactivated owner still gets the bill marked, but receives no notification', async () => {
    const { bank } = await seedUser('gone', '444', new Date())
    const bill = await seedBill(bank.id, addDaysYMD(todayYMD(base), -1))

    await processOverdueBills(at(9, 10))

    expect((await prisma.bill.findUniqueOrThrow({ where: { id: bill.id } })).status).toBe(BillStatus.OVERDUE)
    expect(sendOverdueWarning).not.toHaveBeenCalled()
    expect(await prisma.notificationLog.count()).toBe(0)
  })

  it('a bill due today is not yet overdue and is left untouched', async () => {
    const { bank } = await seedUser('alice')
    const bill = await seedBill(bank.id, todayYMD(base))

    await processOverdueBills(at(9, 10))

    expect((await prisma.bill.findUniqueOrThrow({ where: { id: bill.id } })).status).toBe(BillStatus.PENDING)
    expect(sendOverdueWarning).not.toHaveBeenCalled()
  })

  it('a historical successful warning (pre-existing log row) is not re-sent', async () => {
    const { bank } = await seedUser('alice')
    // Simulates a bill already marked + warned by a prior run (or the old
    // per-bill implementation) before this code shipped.
    const bill = await seedBill(bank.id, addDaysYMD(todayYMD(base), -5), BillStatus.OVERDUE)
    await prisma.notificationLog.create({
      data: { billId: bill.id, ruleId: null, channel: 'telegram', message: OVERDUE_WARNING_MESSAGE, success: true },
    })

    await processOverdueBills(at(9, 10))

    expect(sendOverdueWarning).not.toHaveBeenCalled()
    expect(await prisma.notificationLog.count()).toBe(1) // unchanged
  })

  it('multiple overdue bills across different owners are all marked and each notified once', async () => {
    const { bank: bankA } = await seedUser('alice', '111')
    const { bank: bankB } = await seedUser('bob', '222')
    const billA = await seedBill(bankA.id, addDaysYMD(todayYMD(base), -1))
    const billB = await seedBill(bankB.id, addDaysYMD(todayYMD(base), -2))

    await processOverdueBills(at(9, 10))

    expect((await prisma.bill.findUniqueOrThrow({ where: { id: billA.id } })).status).toBe(BillStatus.OVERDUE)
    expect((await prisma.bill.findUniqueOrThrow({ where: { id: billB.id } })).status).toBe(BillStatus.OVERDUE)
    expect(sendOverdueWarning).toHaveBeenCalledTimes(2)
    expect(await prisma.notificationLog.count()).toBe(2)
  })
})
