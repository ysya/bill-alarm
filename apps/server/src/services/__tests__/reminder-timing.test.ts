import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setupTestDb } from './helpers/test-db.js'
import { todayYMD, addDaysYMD } from '@bill-alarm/shared/date'
import { BillStatus } from '@bill-alarm/shared/types'

setupTestDb()
process.env.LOG_LEVEL = 'silent'

vi.mock('@/services/telegram.js', () => ({
  sendBillReminder: vi.fn(async () => ({ ok: true })),
}))

const { default: prisma } = await import('@/prisma.js')
const { sendBillReminder } = await import('../telegram.js')
const { processReminderRules } = await import('../notification.js')

// Single "now" base for the whole file: all test data (dueDate) and all tick
// times are derived from this one Date, so the suite can't flake if the wall
// clock happens to cross midnight while the tests run.
const base = new Date()

function at(h: number, m: number): Date {
  const d = new Date(base)
  d.setHours(h, m, 0, 0)
  return d
}

beforeEach(async () => {
  // NOT clearAllMocks: resetAllMocks restores vi.fn(impl)'s factory
  // implementation (Vitest 4 semantics), so sendBillReminder goes back to
  // resolving { ok: true } for every test without a manual re-stub.
  vi.resetAllMocks()
  await prisma.notificationLog.deleteMany()
  await prisma.bill.deleteMany()
  await prisma.notificationRule.deleteMany()
  await prisma.bank.deleteMany()
  await prisma.user.deleteMany()
})

async function seedRule(daysBefore = 3, timeOfDay = '09:00') {
  const user = await prisma.user.create({
    data: { username: 'alice', passwordHash: 'x:y', role: 'member', telegramChatId: '111' },
  })
  const bank = await prisma.bank.create({
    data: { name: 'alice-bank', emailSenderPattern: 'x@x', emailSubjectPattern: 'b', userId: user.id },
  })
  const rule = await prisma.notificationRule.create({
    data: { name: 'r', daysBefore, timeOfDay, channels: JSON.stringify(['telegram']), userId: user.id },
  })
  return { user, bank, rule }
}

async function seedBill(bankId: string, daysBefore: number) {
  return prisma.bill.create({
    data: {
      bankId,
      billingPeriod: '2026-07',
      amount: 100,
      dueDate: addDaysYMD(todayYMD(base), daysBefore),
      status: BillStatus.PENDING,
    },
  })
}

describe('processReminderRules: timeOfDay gate + 15-minute tick', () => {
  it('case 1: a tick before timeOfDay does not send', async () => {
    const { bank } = await seedRule(3, '09:00')
    await seedBill(bank.id, 3)

    await processReminderRules(at(8, 50))

    expect(sendBillReminder).not.toHaveBeenCalled()
  })

  it('case 2: the first tick at/after timeOfDay sends once', async () => {
    const { bank } = await seedRule(3, '09:00')
    await seedBill(bank.id, 3)

    await processReminderRules(at(9, 10))

    expect(sendBillReminder).toHaveBeenCalledTimes(1)
    const logs = await prisma.notificationLog.findMany()
    expect(logs).toHaveLength(1)
    expect(logs[0].success).toBe(true)
  })

  it('case 3: a later tick the same day does not re-send (NotificationLog dedup)', async () => {
    const { bank } = await seedRule(3, '09:00')
    await seedBill(bank.id, 3)

    await processReminderRules(at(9, 10))
    await processReminderRules(at(9, 25))

    expect(sendBillReminder).toHaveBeenCalledTimes(1)
  })

  it('case 4: a failed send leaves no successful log, so the next tick retries', async () => {
    const { bank } = await seedRule(3, '09:00')
    await seedBill(bank.id, 3)
    vi.mocked(sendBillReminder).mockResolvedValueOnce({ ok: false, error: 'boom' })

    await processReminderRules(at(9, 10))
    expect(sendBillReminder).toHaveBeenCalledTimes(1)
    const logsAfterFailure = await prisma.notificationLog.findMany()
    expect(logsAfterFailure).toHaveLength(1)
    expect(logsAfterFailure[0].success).toBe(false)
    expect(logsAfterFailure[0].errorMessage).toBe('boom')

    await processReminderRules(at(9, 25))
    expect(sendBillReminder).toHaveBeenCalledTimes(2)
    const logsAfterRetry = await prisma.notificationLog.findMany({ orderBy: { sentAt: 'asc' } })
    expect(logsAfterRetry).toHaveLength(2)
    expect(logsAfterRetry[1].success).toBe(true)
  })

  it('self-heals after downtime: a tick well past timeOfDay still fires once', async () => {
    const { bank } = await seedRule(3, '09:00')
    await seedBill(bank.id, 3)

    // Simulates a missed 09:00 tick (e.g. deploy/downtime) — the first tick
    // to run at all today, at 14:00, must still fire.
    await processReminderRules(at(14, 0))

    expect(sendBillReminder).toHaveBeenCalledTimes(1)
  })

  it('a bill that appears later in the day is still reminded on that later tick', async () => {
    const { bank } = await seedRule(3, '09:00')

    // No matching bill exists yet at the 09:10 tick.
    await processReminderRules(at(9, 10))
    expect(sendBillReminder).not.toHaveBeenCalled()

    // The bill shows up later (e.g. a scan ran mid-morning); the next tick
    // still reminds today, even though timeOfDay has already passed.
    await seedBill(bank.id, 3)
    await processReminderRules(at(10, 0))

    expect(sendBillReminder).toHaveBeenCalledTimes(1)
  })

  it('autoDebit bank is skipped even when due and past timeOfDay', async () => {
    const { bank } = await seedRule(3, '09:00')
    await prisma.bank.update({ where: { id: bank.id }, data: { autoDebit: true } })
    await seedBill(bank.id, 3)

    await processReminderRules(at(9, 10))

    expect(sendBillReminder).not.toHaveBeenCalled()
    expect(await prisma.notificationLog.count()).toBe(0)
  })

  it('inactive rules are ignored regardless of time', async () => {
    const { bank, rule } = await seedRule(3, '09:00')
    await prisma.notificationRule.update({ where: { id: rule.id }, data: { isActive: false } })
    await seedBill(bank.id, 3)

    await processReminderRules(at(9, 10))

    expect(sendBillReminder).not.toHaveBeenCalled()
  })
})
