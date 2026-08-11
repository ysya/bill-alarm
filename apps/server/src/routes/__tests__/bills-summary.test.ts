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
})
