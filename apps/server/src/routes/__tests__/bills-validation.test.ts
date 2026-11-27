import { describe, it, expect } from 'vitest'
import { BillStatus, fundingRemaining, isAwaitingDebit } from '@bill-alarm/shared/types'
import { addDaysYMD, todayYMD } from '@bill-alarm/shared/date'
import { setupTestDb } from '../../services/__tests__/helpers/test-db.js'

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
const adminCookie = cookieOf(setup)

describe('bills: dueDate validity', () => {
  it('PATCH /api/bills/:id with an impossible calendar date (2026-02-31) returns 400 and does not write', async () => {
    const user = await prisma.user.findUnique({ where: { username: 'boss' } })
    const bank = await prisma.bank.create({
      data: { name: 'Validity Bank', emailSenderPattern: 'v@v', emailSubjectPattern: 'v', userId: user!.id },
    })
    const bill = await prisma.bill.create({
      data: { bankId: bank.id, billingPeriod: '2026-06', amount: 100, dueDate: '2026-07-15' },
    })

    const res = await app.request(`/api/bills/${bill.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ dueDate: '2026-02-31' }),
    })
    expect(res.status).toBe(400)
    const stored = await prisma.bill.findUnique({ where: { id: bill.id } })
    expect(stored?.dueDate).toBe('2026-07-15')
  })

  it('PATCH /api/bills/:id with a valid calendar date (2026-02-28) returns 200 and writes', async () => {
    const user = await prisma.user.findUnique({ where: { username: 'boss' } })
    const bank = await prisma.bank.create({
      data: { name: 'Validity Bank 2', emailSenderPattern: 'v2@v', emailSubjectPattern: 'v2', userId: user!.id },
    })
    const bill = await prisma.bill.create({
      data: { bankId: bank.id, billingPeriod: '2026-01', amount: 200, dueDate: '2026-07-15' },
    })

    const res = await app.request(`/api/bills/${bill.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ dueDate: '2026-02-28' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.dueDate).toBe('2026-02-28')
  })
})

describe('bills: manual auto-debit tracking', () => {
  async function createBill(autoDebit: boolean, status = BillStatus.PENDING) {
    const user = await prisma.user.findUniqueOrThrow({ where: { username: 'boss' } })
    const bank = await prisma.bank.create({
      data: { name: 'Funding test bank', emailSenderPattern: 'funding@bank', emailSubjectPattern: 'bill', userId: user.id, autoDebit },
    })
    return prisma.bill.create({
      data: { bankId: bank.id, billingPeriod: todayYMD().slice(0, 7), amount: 400, dueDate: addDaysYMD(todayYMD(), -1), status },
    })
  }

  function request(path: string, method = 'GET', data?: Record<string, unknown>) {
    return app.request(`/api/bills${path}`, {
      method,
      headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
      body: data === undefined ? undefined : JSON.stringify(data),
    })
  }

  it('tracks the transfer independently of settlement and restores it when settlement is undone', async () => {
    const bill = await createBill(true, BillStatus.OVERDUE)
    const before = await (await request('/summary')).json()
    const transfer = await request(`/${bill.id}/transfer`, 'PATCH', { transferred: true })
    expect(transfer.status).toBe(200)
    const recorded = await transfer.json()
    expect(recorded).toMatchObject({ status: BillStatus.OVERDUE, transferredAmount: 400 })
    expect(recorded.paidAt).toBeNull()
    expect(recorded.transferredAt).toEqual(expect.any(String))
    expect(await (await request(`/${bill.id}/transfer`, 'PATCH', { transferred: true })).json())
      .toMatchObject({ transferredAt: recorded.transferredAt })
    expect(await (await request('/summary')).json()).toMatchObject({
      totalPending: before.totalPending,
      totalTransferred: 400,
      overdueCount: before.overdueCount - 1,
      paidCount: before.paidCount,
    })
    expect((await (await request('?status=unpaid')).json()).data).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: bill.id }),
    ]))

    expect(await (await request(`/${bill.id}/pay`, 'PATCH', {})).json()).toMatchObject({
      status: BillStatus.PAID,
      paidAt: expect.any(String),
      paidByAutoDebit: true,
      transferredAt: recorded.transferredAt,
    })
    expect(await (await request('/summary')).json()).toMatchObject({ totalTransferred: 0, paidCount: before.paidCount + 1 })
    expect((await request(`/${bill.id}/transfer`, 'PATCH', { transferred: false })).status).toBe(409)

    expect(await (await request(`/${bill.id}/unpay`, 'POST')).json()).toMatchObject({
      status: BillStatus.PENDING, paidAt: null, paidByAutoDebit: false, transferredAt: recorded.transferredAt,
    })
    expect(await (await request(`/${bill.id}/transfer`, 'PATCH', { transferred: false })).json())
      .toMatchObject({ transferredAt: null, transferredAmount: null })
  })

  it('preserves the recorded amount through edits and records each top-up only once', async () => {
    const bill = await createBill(true)
    const billPath = `/${bill.id}`
    const transfer = (amount?: number) => request(`${billPath}/transfer`, 'PATCH', { transferred: true, amount })
    const before = await (await request('/summary')).json()
    await request(billPath, 'PATCH', { amount: 4200 })
    const recorded = await (await transfer(4200)).json()
    expect(recorded.transferredAmount).toBe(4200)
    expect(isAwaitingDebit(recorded)).toBe(true)

    const increased = await (await request(billPath, 'PATCH', { amount: 5200 })).json()
    expect(increased.transferredAmount).toBe(4200)
    expect(fundingRemaining(increased)).toBe(1000)
    expect(isAwaitingDebit(increased)).toBe(false)
    expect(await (await request('/summary')).json()).toMatchObject({
      totalTransferred: before.totalTransferred + 4200,
      totalToFund: before.totalToFund - bill.amount + 1000,
    })

    // Both an old boolean-only request and a retry of the initial transfer are harmless.
    for (const retry of [await transfer(), await transfer(4200)]) {
      expect(await retry.json()).toMatchObject({ transferredAt: recorded.transferredAt, transferredAmount: 4200 })
    }
    expect((await transfer(5000)).status).toBe(409)
    const topUps = await Promise.all([transfer(5200), transfer(5200)])
    for (const res of topUps) {
      expect(res.status).toBe(200)
      const toppedUp = await res.json()
      expect(toppedUp).toMatchObject({ transferredAt: recorded.transferredAt, transferredAmount: 5200 })
      expect(isAwaitingDebit(toppedUp)).toBe(true)
    }

    const reduced = await (await request(billPath, 'PATCH', { amount: 3000 })).json()
    expect(reduced.transferredAmount).toBe(5200)
    expect(fundingRemaining(reduced)).toBe(0)
    expect(isAwaitingDebit(reduced)).toBe(true)
    expect(await (await transfer(3000)).json()).toMatchObject({ transferredAmount: 5200 })
    expect(await (await request(billPath, 'PATCH', { status: BillStatus.NO_PAYMENT })).json())
      .toMatchObject({ transferredAt: null, transferredAmount: null })
  })

  it('allows direct debit confirmation and preserves it when editing the payment date', async () => {
    const bill = await createBill(true)
    const pay = await request(`/${bill.id}/pay`, 'PATCH', {})
    expect(await pay.json()).toMatchObject({ status: BillStatus.PAID, paidByAutoDebit: true, transferredAt: null })

    await prisma.bank.update({ where: { id: bill.bankId }, data: { autoDebit: false } })
    const paidAt = '2026-07-01T00:00:00.000Z'
    const edit = await request(`/${bill.id}/pay`, 'PATCH', { paidAt })
    expect(await edit.json()).toMatchObject({ paidAt, paidByAutoDebit: true })
  })

  it('requires fresh funding after a card changes debit accounts, including when a paid bill is reopened', async () => {
    const bill = await createBill(true)
    const paid = await prisma.bill.create({
      data: { bankId: bill.bankId, billingPeriod: '2001-01', amount: 600, dueDate: bill.dueDate },
    })
    const user = await prisma.user.findUniqueOrThrow({ where: { username: 'boss' } })
    const [a, b] = await Promise.all(['A', 'B'].map(name => prisma.bankAccount.create({
      data: { name, bankName: 'Savings', userId: user.id },
    })))
    const headers = { Cookie: adminCookie, 'Content-Type': 'application/json' }
    const bind = (bankAccountId: string | null) => app.request(`/api/banks/${bill.bankId}`, {
      method: 'PATCH', headers, body: JSON.stringify({ bankAccountId }),
    })
    const transfer = (id: string, bankAccountId: string | null) =>
      request(`/${id}/transfer`, 'PATCH', { transferred: true, bankAccountId })

    expect((await transfer(bill.id, null)).status).toBe(200)
    expect((await bind(a.id)).status).toBe(200)
    expect((await bind(a.id)).status).toBe(200)
    expect(await (await request(`/${bill.id}`)).json()).toMatchObject({ transferredAmount: 400, transferredAccountId: a.id })
    expect((await transfer(paid.id, a.id)).status).toBe(200)
    expect((await request(`/${paid.id}/pay`, 'PATCH', {})).status).toBe(200)
    expect((await app.request(`/api/bank-accounts/${a.id}`, { method: 'DELETE', headers })).status).toBe(400)

    // Serialization gives either order the same result: no transfer into A can fund B.
    const [switchAccount, racingTransfer] = await Promise.all([bind(b.id), transfer(bill.id, a.id)])
    expect(switchAccount.status).toBe(200)
    expect([200, 409]).toContain(racingTransfer.status)
    expect((await transfer(bill.id, a.id)).status).toBe(409)
    expect(await (await request(`/${bill.id}`)).json()).toMatchObject({
      transferredAt: null, transferredAmount: null, transferredAccountId: null, bank: { bankAccountId: b.id },
    })
    expect((await (await request('/summary')).json()).fundingAccounts).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: b.id, remaining: 400 }),
    ]))
    expect(await (await request(`/${paid.id}`)).json()).toMatchObject({
      status: BillStatus.PAID, transferredAmount: 600, transferredAccountId: a.id,
    })
    expect((await app.request(`/api/bank-accounts/${a.id}`, { method: 'DELETE', headers })).status).toBe(200)
    expect(await (await request(`/${paid.id}/unpay`, 'POST')).json()).toMatchObject({
      status: BillStatus.PENDING, transferredAt: null, transferredAmount: null, transferredAccountId: null,
    })
    expect((await transfer(bill.id, b.id)).status).toBe(200)
    expect((await transfer(paid.id, b.id)).status).toBe(200)
    expect((await request(`/${paid.id}/pay`, 'PATCH', {})).status).toBe(200)
    expect((await bind(null)).status).toBe(200)
    expect(await (await request(`/${bill.id}`)).json()).toMatchObject({ transferredAt: null, transferredAmount: null })
    expect(await (await request(`/${paid.id}`, 'PATCH', { status: BillStatus.OVERDUE })).json()).toMatchObject({
      status: BillStatus.OVERDUE, transferredAt: null, transferredAmount: null,
    })
  })

  it('rejects transfer marking for a manual-payment bank and for a bill with no payment due', async () => {
    const manual = await createBill(false)
    const noPayment = await createBill(true, BillStatus.NO_PAYMENT)
    expect((await request(`/${manual.id}/transfer`, 'PATCH', { transferred: true })).status).toBe(409)
    expect((await request(`/${noPayment.id}/transfer`, 'PATCH', { transferred: true })).status).toBe(409)
  })
})

describe('bills: paidAt state transitions on PATCH', () => {
  it('PATCH status -> paid sets paidAt when it was not already set', async () => {
    const user = await prisma.user.findUnique({ where: { username: 'boss' } })
    const bank = await prisma.bank.create({
      data: { name: 'PaidAt Bank', emailSenderPattern: 'pa@pa', emailSubjectPattern: 'pa', userId: user!.id },
    })
    const bill = await prisma.bill.create({
      data: { bankId: bank.id, billingPeriod: '2026-07', amount: 500, dueDate: '2026-07-15', status: BillStatus.PENDING },
    })
    expect(bill.paidAt).toBeNull()

    const res = await app.request(`/api/bills/${bill.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ status: 'paid' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('paid')
    expect(body.paidAt).not.toBeNull()
    const stored = await prisma.bill.findUnique({ where: { id: bill.id } })
    expect(stored?.paidAt).not.toBeNull()
  })

  it('PATCH status paid -> pending clears paidAt back to null', async () => {
    const user = await prisma.user.findUnique({ where: { username: 'boss' } })
    const bank = await prisma.bank.create({
      data: { name: 'PaidAt Bank 2', emailSenderPattern: 'pa2@pa', emailSubjectPattern: 'pa2', userId: user!.id },
    })
    const bill = await prisma.bill.create({
      data: {
        bankId: bank.id,
        billingPeriod: '2026-08',
        amount: 600,
        dueDate: '2026-08-15',
        status: BillStatus.PAID,
        paidAt: new Date('2026-08-01T00:00:00Z'),
      },
    })

    const res = await app.request(`/api/bills/${bill.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ status: 'pending' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('pending')
    expect(body.paidAt).toBeNull()
    const stored = await prisma.bill.findUnique({ where: { id: bill.id } })
    expect(stored?.paidAt).toBeNull()
  })

  it('PATCH status -> paid when paidAt is already set leaves the existing paidAt untouched', async () => {
    const user = await prisma.user.findUnique({ where: { username: 'boss' } })
    const bank = await prisma.bank.create({
      data: { name: 'PaidAt Bank 3', emailSenderPattern: 'pa3@pa', emailSubjectPattern: 'pa3', userId: user!.id },
    })
    const originalPaidAt = new Date('2026-06-01T00:00:00Z')
    const bill = await prisma.bill.create({
      data: {
        bankId: bank.id,
        billingPeriod: '2026-06',
        amount: 700,
        dueDate: '2026-06-15',
        status: BillStatus.PAID,
        paidAt: originalPaidAt,
      },
    })

    const res = await app.request(`/api/bills/${bill.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ status: 'paid' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(new Date(body.paidAt).toISOString()).toBe(originalPaidAt.toISOString())
  })

  it('PATCH status OVERDUE -> paid stamps paidAt (helper is old-status-agnostic, not just pending -> paid)', async () => {
    const user = await prisma.user.findUnique({ where: { username: 'boss' } })
    const bank = await prisma.bank.create({
      data: { name: 'PaidAt Bank 5', emailSenderPattern: 'pa5@pa', emailSubjectPattern: 'pa5', userId: user!.id },
    })
    const bill = await prisma.bill.create({
      data: { bankId: bank.id, billingPeriod: '2026-04', amount: 1000, dueDate: '2026-04-15', status: BillStatus.OVERDUE },
    })
    expect(bill.paidAt).toBeNull()

    const res = await app.request(`/api/bills/${bill.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ status: 'paid' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('paid')
    expect(body.paidAt).not.toBeNull()
    const stored = await prisma.bill.findUnique({ where: { id: bill.id } })
    expect(stored?.status).toBe(BillStatus.PAID)
    expect(stored?.paidAt).not.toBeNull()
  })

  it('PATCH without a status field does not touch paidAt', async () => {
    const user = await prisma.user.findUnique({ where: { username: 'boss' } })
    const bank = await prisma.bank.create({
      data: { name: 'PaidAt Bank 4', emailSenderPattern: 'pa4@pa', emailSubjectPattern: 'pa4', userId: user!.id },
    })
    const bill = await prisma.bill.create({
      data: { bankId: bank.id, billingPeriod: '2026-05', amount: 800, dueDate: '2026-05-15', status: BillStatus.PENDING },
    })

    const res = await app.request(`/api/bills/${bill.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ amount: 900 }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.amount).toBe(900)
    expect(body.paidAt).toBeNull()
  })
})
