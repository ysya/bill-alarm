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
const bank = await prisma.bank.create({
  data: { name: 'b', emailSenderPattern: 'x@x', emailSubjectPattern: 's', userId: user.id },
})
const today = todayYMD()
// 逾期(昨天)、待繳(3天後)、已繳、免繳 各一
await prisma.bill.createMany({
  data: [
    { bankId: bank.id, billingPeriod: 'p1', amount: 100, dueDate: addDaysYMD(today, -1), status: BillStatus.OVERDUE },
    { bankId: bank.id, billingPeriod: 'p2', amount: 200, dueDate: addDaysYMD(today, 3), status: BillStatus.PENDING },
    { bankId: bank.id, billingPeriod: 'p3', amount: 300, dueDate: today, status: BillStatus.PAID },
    { bankId: bank.id, billingPeriod: 'p4', amount: 400, dueDate: today, status: BillStatus.NO_PAYMENT },
  ],
})

describe('GET /bills?status=unpaid', () => {
  it('returns pending+overdue only, dueDate ascending (overdue first)', async () => {
    const res = await app.request('/api/bills?status=unpaid', { headers: { Cookie: boss } })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.total).toBe(2)
    expect(body.data.map((b: { status: string }) => b.status)).toEqual(['overdue', 'pending'])
  })

  it('plain status filters still work', async () => {
    const res = await app.request('/api/bills?status=paid', { headers: { Cookie: boss } })
    expect((await res.json()).total).toBe(1)
  })
})
