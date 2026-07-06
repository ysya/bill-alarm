import { describe, it, expect, beforeAll } from 'vitest'
import { setupTestDb } from './helpers/test-db.js'

setupTestDb()

const { emailAlreadyProcessed, duplicateBillExists } = await import('../email-parser.js')
const { default: prisma } = await import('@/prisma.js')

describe('scan dedup guards', () => {
  let bankId: string

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { username: 'dedup-owner', passwordHash: 'x:y', role: 'member' },
    })
    const bank = await prisma.bank.create({
      data: { name: '測試銀行', emailSenderPattern: 'test@bank', emailSubjectPattern: '帳單', userId: user.id },
    })
    bankId = bank.id
    await prisma.bill.create({
      data: {
        bankId,
        billingPeriod: '2026-05',
        amount: 7100,
        dueDate: new Date('2026-06-08'),
        sourceEmailId: '46567',
      },
    })
  })

  it('emailAlreadyProcessed: true for a msgId that already produced a bill', async () => {
    expect(await emailAlreadyProcessed('46567')).toBe(true)
  })

  it('emailAlreadyProcessed: false for unseen msgId', async () => {
    expect(await emailAlreadyProcessed('99999')).toBe(false)
  })

  it('duplicateBillExists: true for same bank+amount+dueDate even with different period', async () => {
    // 滙豐案例：provider 遷移後同帳單換了 msgId，只有這道防線擋得住
    expect(await duplicateBillExists(bankId, 7100, new Date('2026-06-08'))).toBe(true)
  })

  it('duplicateBillExists: false when amount differs', async () => {
    expect(await duplicateBillExists(bankId, 9999, new Date('2026-06-08'))).toBe(false)
  })
})
