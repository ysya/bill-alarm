import { describe, it, expect, beforeAll } from 'vitest'
import { setupTestDb } from './helpers/test-db.js'

setupTestDb()

const { emailAlreadyProcessed, duplicateBillExists } = await import('../email-parser.js')
const { default: prisma } = await import('@/prisma.js')

describe('scan dedup guards', () => {
  let userId: string
  let bankId: string

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { username: 'dedup-owner', passwordHash: 'x:y', role: 'member' },
    })
    userId = user.id
    const bank = await prisma.bank.create({
      data: { name: '測試銀行', emailSenderPattern: 'test@bank', emailSubjectPattern: '帳單', userId: user.id },
    })
    bankId = bank.id
    await prisma.bill.create({
      data: {
        bankId,
        billingPeriod: '2026-05',
        amount: 7100,
        dueDate: '2026-06-08',
        sourceEmailId: '46567',
      },
    })
  })

  it('emailAlreadyProcessed: true for a msgId that already produced a bill for this user', async () => {
    expect(await emailAlreadyProcessed('46567', userId)).toBe(true)
  })

  it('emailAlreadyProcessed: false for unseen msgId', async () => {
    expect(await emailAlreadyProcessed('99999', userId)).toBe(false)
  })

  it('duplicateBillExists: true for same bank+amount+dueDate even with different period', async () => {
    // 滙豐案例：provider 遷移後同帳單換了 msgId，只有這道防線擋得住
    expect(await duplicateBillExists(bankId, 7100, '2026-06-08')).toBe(true)
  })

  it('duplicateBillExists: false when amount differs', async () => {
    expect(await duplicateBillExists(bankId, 9999, '2026-06-08')).toBe(false)
  })

  it('emailAlreadyProcessed: IMAP UIDs are per-mailbox — another user with the same UID is not suppressed', async () => {
    // Regression for cross-tenant dedup leak: IMAP UIDs are per-mailbox integers,
    // so user B's mailbox can independently have a message with the same UID
    // ('12345') as user A's already-processed bill. That must NOT count as
    // "already processed" for user B.
    const userA = await prisma.user.create({
      data: { username: 'dedup-user-a', passwordHash: 'x:y', role: 'member' },
    })
    const userB = await prisma.user.create({
      data: { username: 'dedup-user-b', passwordHash: 'x:y', role: 'member' },
    })
    const bankA = await prisma.bank.create({
      data: { name: 'A 銀行', emailSenderPattern: 'a@bank', emailSubjectPattern: '帳單', userId: userA.id },
    })
    await prisma.bank.create({
      data: { name: 'B 銀行', emailSenderPattern: 'b@bank', emailSubjectPattern: '帳單', userId: userB.id },
    })
    await prisma.bill.create({
      data: {
        bankId: bankA.id,
        billingPeriod: '2026-05',
        amount: 3200,
        dueDate: '2026-06-10',
        sourceEmailId: '12345',
      },
    })

    expect(await emailAlreadyProcessed('12345', userA.id)).toBe(true)
    expect(await emailAlreadyProcessed('12345', userB.id)).toBe(false)
  })
})
