import { describe, it, expect } from 'vitest'
import { setupTestDb } from '../../services/__tests__/helpers/test-db.js'
import { todayYMD, addDaysYMD } from '@bill-alarm/shared/date'
import { BillStatus } from '@bill-alarm/shared/types'

setupTestDb()
process.env.LOG_LEVEL = 'silent'

const { default: app } = await import('@/index.js')
const { default: prisma } = await import('@/prisma.js')

function cookieOf(res: Response): string {
  return res.headers.get('set-cookie')?.split(';')[0] ?? ''
}

const setup = await app.request('/api/auth/setup', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'boss', password: 'admin-password' }),
})
const boss = cookieOf(setup)

const user = await prisma.user.findUniqueOrThrow({ where: { username: 'boss' } })
// bills 有 @@unique([bankId, billingPeriod])，同期別的已繳帳單放第二家銀行
const bank = await prisma.bank.create({
  data: { name: 'b', emailSenderPattern: 'x@x', emailSubjectPattern: 's', userId: user.id },
})
const bank2 = await prisma.bank.create({
  data: { name: 'b2', emailSenderPattern: 'y@y', emailSubjectPattern: 's', userId: user.id },
})
const today = todayYMD()
const currentMonth = today.slice(0, 7)
await prisma.bill.createMany({
  data: [
    // 逾期 100 + 待繳 200 → totalPending 應為 300、pendingCount 2、overdueCount 1
    { bankId: bank.id, billingPeriod: '2026-01', amount: 100, dueDate: addDaysYMD(today, -1), status: BillStatus.OVERDUE },
    { bankId: bank.id, billingPeriod: currentMonth, amount: 200, dueDate: addDaysYMD(today, 3), status: BillStatus.PENDING },
    { bankId: bank2.id, billingPeriod: currentMonth, amount: 300, dueDate: today, status: BillStatus.PAID },
  ],
})

describe('GET /bills/summary', () => {
  it('totalPending and pendingCount include overdue; paidCount is current-period', async () => {
    const res = await app.request('/api/bills/summary', { headers: { Cookie: boss } })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.totalPending).toBe(300) // 100 (overdue) + 200 (pending)
    expect(body.pendingCount).toBe(2)
    expect(body.overdueCount).toBe(1)
    expect(body.paidCount).toBe(1)
    expect(body.nextDueDate).toBe(addDaysYMD(today, 3))
  })

  it('timeline is gone; breakdown appears only with month param', async () => {
    const plain = await (await app.request('/api/bills/summary', { headers: { Cookie: boss } })).json()
    expect(plain.timeline).toBeUndefined()
    expect(plain.breakdown).toBeUndefined()

    const withMonth = await (await app.request(`/api/bills/summary?month=${currentMonth}`, { headers: { Cookie: boss } })).json()
    expect(withMonth.timeline).toBeUndefined()
    expect(withMonth.breakdown).toHaveLength(2) // 兩家銀行各一筆本期帳單
    const totals = withMonth.breakdown.map((x: { totalAmount: number }) => x.totalAmount).sort()
    expect(totals).toEqual([200, 300])
  })

  it('drills down from overdue and current-period paid counts to the exact bills', async () => {
    const read = async (query: string) => (await app.request('/api/bills?' + query, { headers: { Cookie: boss } })).json()
    const overdue = await read('status=unpaid&view=overdue')
    expect(overdue.total).toBe(1)
    expect(overdue.data[0].amount).toBe(100)
    const period = await read('status=paid&billingPeriod=1999-01')
    expect(period.total).toBe(0)
    expect((await read('status=paid&billingPeriod=' + currentMonth)).total).toBe(1)
  })

  it('groups cards by debit account and keeps a funding shortfall separate from excess on another bill', async () => {
    const account = await prisma.bankAccount.create({ data: { userId: user.id, name: 'Reserve', bankName: 'Savings' } })
    await prisma.bank.updateMany({ where: { id: { in: [bank.id, bank2.id] } }, data: { autoDebit: true, bankAccountId: account.id } })
    const late = await prisma.bill.findFirstOrThrow({ where: { bankId: bank.id, status: BillStatus.OVERDUE } })
    await prisma.bill.update({ where: { id: late.id }, data: { transferredAt: new Date(), transferredAmount: 70 } })
    const funded = await prisma.bill.create({ data: {
      bankId: bank2.id, billingPeriod: '1999-02', amount: 400, dueDate: today,
      transferredAt: new Date(), transferredAmount: 700,
    } })
    const read = async (path: string) => (await app.request('/api/bills' + path, { headers: { Cookie: boss } })).json()
    const summary = await read('/summary')
    expect(summary.totalToFund).toBe(230)
    expect(summary.tasks.awaiting.map((b: { id: string }) => b.id)).toEqual([funded.id])
    expect(summary.fundingAccounts).toHaveLength(1)
    expect(summary.fundingAccounts[0]).toMatchObject({
      id: account.id, name: 'Reserve', remaining: 230, nextDueDate: late.dueDate,
    })
    expect(summary.fundingAccounts[0].bills).toHaveLength(3)
    for (const [view, expected] of [['overdue', [late.id]], ['awaiting', [funded.id]]] as const) {
      const filtered = await read('?status=unpaid&view=' + view)
      expect(filtered.data.map((b: { id: string }) => b.id)).toEqual(expected)
    }
    expect((await read('?status=unpaid&view=funding')).total).toBe(2)
    expect((await read('?status=unpaid&view=upcoming')).total).toBe(1)
  })

  it('counts all tasks beyond the first hundred while keeping the overview preview short', async () => {
    const card = await prisma.bank.create({
      data: { name: 'History', emailSenderPattern: 'history@example.test', emailSubjectPattern: 's', userId: user.id },
    })
    await prisma.bill.createMany({
      data: Array.from({ length: 110 }, (_, index) => ({
        bankId: card.id,
        billingPeriod: `${2000 + Math.floor(index / 12)}-${String(index % 12 + 1).padStart(2, '0')}`,
        amount: 10,
        dueDate: addDaysYMD(today, index + 1),
      })),
    })
    const read = async (path: string) => (await app.request('/api/bills' + path, { headers: { Cookie: boss } })).json()
    const { tasks } = await read('/summary')
    const first = await read('?status=unpaid&view=upcoming')
    const sixth = await read('?status=unpaid&view=upcoming&page=6')
    expect(tasks.upcomingCount).toBeGreaterThanOrEqual(110)
    expect(tasks.upcomingCount).toBe(first.total)
    expect(tasks.upcoming.map((b: { id: string }) => b.id)).toEqual(first.data.slice(0, 5).map((b: { id: string }) => b.id))
    expect(sixth.data).toHaveLength(tasks.upcomingCount - 100)
  })
})
