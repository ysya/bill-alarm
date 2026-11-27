import fs from 'node:fs/promises'
import path from 'node:path'
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import prisma from '@/prisma.js'
import { DATA_DIR } from '@/paths.js'
import { decryptPdf } from '@/services/pdf-parser.js'
import { parseBillWithLLM, getLlmProvider, LlmProvider } from '@/services/llm-parser.js'
import { getBankPdfPassword } from '@/services/secrets.js'
import { BillStatus, fundingRemaining, isAwaitingDebit, type FundingAccountSummary } from '@bill-alarm/shared/types'
import type { Bill, Prisma } from '../../generated/prisma/client.js'
import { todayYMD, isValidYMD } from '@bill-alarm/shared/date'
import { getAuthUser } from './auth.js'

const app = new Hono()
const unpaidStatuses = [BillStatus.PENDING, BillStatus.OVERDUE]

/** Load a bill only if it belongs to the caller (via bank ownership). */
async function ownBill(c: Parameters<typeof getAuthUser>[0], id: string) {
  return prisma.bill.findFirst({ where: { id, bank: { userId: getAuthUser(c).id } } })
}

const updateBillSchema = z.object({
  amount: z.number().int().optional(),
  minimumPayment: z.number().int().positive().nullable().optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'dueDate 須為 YYYY-MM-DD 格式').refine(isValidYMD, 'dueDate 不是有效日期').optional(),
  billingPeriod: z.string().regex(/^\d{4}-\d{2}$/, 'billingPeriod 須為 YYYY-MM 格式').optional(),
  status: z.nativeEnum(BillStatus).optional(),
})

// Dashboard summary
app.get('/summary', async (c) => {
  const month = c.req.query('month')
  const today = todayYMD()
  const currentMonth = today.slice(0, 7)
  const userId = getAuthUser(c).id

  // "Pending" figures cover everything still owed — pending AND overdue —
  // so the dashboard's headline number matches what the user must pay.
  const [unpaid, paid] = await Promise.all([
    prisma.bill.findMany({
      where: { status: { in: unpaidStatuses }, bank: { userId } },
      orderBy: [{ dueDate: 'asc' }, { id: 'asc' }],
      select: {
        id: true, amount: true, status: true, dueDate: true, billingPeriod: true, transferredAt: true, transferredAmount: true,
        bank: { select: {
          id: true, name: true, code: true, autoDebit: true, isActive: true,
          bankAccount: { select: { id: true, name: true, bankName: true, userId: true } },
        } },
      },
    }),
    prisma.bill.count({ where: { status: BillStatus.PAID, billingPeriod: currentMonth, bank: { userId } } }),
  ])

  const totalPending = unpaid.reduce((sum, b) => sum + b.amount, 0)
  const totalTransferred = unpaid.reduce((sum, b) => sum + (b.transferredAmount ?? 0), 0)
  const totalToFund = unpaid.reduce((sum, b) => sum + fundingRemaining(b), 0)
  const accounts = new Map<string | null, FundingAccountSummary>()
  const bills = unpaid.map(({ bank: { bankAccount, ...bank }, ...bill }) => {
    const account = bankAccount?.userId === userId ? bankAccount : null
    if (bank.autoDebit || bill.transferredAt) {
      const key = account?.id ?? null
      const group: FundingAccountSummary = accounts.get(key) ?? {
        id: key, name: account?.name ?? '未指定扣款帳戶', bankName: account?.bankName ?? null,
        nextDueDate: bill.dueDate, remaining: 0, bills: [],
      }
      const remaining = fundingRemaining(bill)
      group.remaining += remaining
      group.bills.push({ id: bill.id, name: bank.name, period: bill.billingPeriod, dueDate: bill.dueDate, remaining })
      accounts.set(key, group)
    }
    return { ...bill, bank: { ...bank, bankAccountId: account?.id ?? null } }
  })
  const awaiting = bills.filter(isAwaitingDebit)
  const overdue = bills.filter(b => b.status === BillStatus.OVERDUE && !isAwaitingDebit(b))
  const upcoming = bills.filter(b => b.status === BillStatus.PENDING && !isAwaitingDebit(b))
  const previewSize = 5

  const result: Record<string, unknown> = {
    totalPending,
    totalTransferred,
    totalToFund,
    paidBillingPeriod: currentMonth,
    fundingAccounts: [...accounts.values()],
    tasks: {
      overdue: overdue.slice(0, previewSize),
      upcoming: upcoming.slice(0, previewSize), upcomingCount: upcoming.length,
      awaiting: awaiting.slice(0, previewSize), awaitingCount: awaiting.length,
    },
    pendingCount: unpaid.length,
    paidCount: paid,
    overdueCount: overdue.length,
    nextDueDate: unpaid.find(b => b.dueDate >= today)?.dueDate ?? null,
  }

  if (month) {
    const monthBills = await prisma.bill.findMany({
      where: { billingPeriod: month, bank: { userId } },
      include: { bank: { select: { id: true, name: true, autoDebit: true } } },
      orderBy: { dueDate: 'asc' },
    })

    const breakdownMap = new Map<string, { bankId: string; bankName: string; totalAmount: number; billCount: number; autoDebit: boolean }>()
    for (const b of monthBills) {
      const existing = breakdownMap.get(b.bankId)
      if (existing) {
        existing.totalAmount += b.amount
        existing.billCount++
      } else {
        breakdownMap.set(b.bankId, {
          bankId: b.bankId,
          bankName: b.bank.name,
          totalAmount: b.amount,
          billCount: 1,
          autoDebit: b.bank.autoDebit,
        })
      }
    }

    result.breakdown = Array.from(breakdownMap.values())
  }

  return c.json(result)
})

// List bills with filters + pagination
app.get('/', async (c) => {
  const { status, bankId, view, billingPeriod } = c.req.query()
  const page = Math.max(1, Number(c.req.query('page')) || 1)
  const pageSize = Math.min(100, Math.max(1, Number(c.req.query('pageSize')) || 20))

  const where: Prisma.BillWhereInput = { bank: { userId: getAuthUser(c).id } }
  // 'unpaid' is a virtual filter: everything still owed (pending + overdue).
  if (status === 'unpaid') where.status = { in: unpaidStatuses }
  else if (status) where.status = status
  if (bankId) where.bankId = bankId
  if (billingPeriod) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(billingPeriod)) return c.json({ error: '帳期格式錯誤' }, 400)
    where.billingPeriod = billingPeriod
  }
  if (view && status === 'unpaid') {
    const amount = prisma.bill.fields.amount
    if (view === 'awaiting') {
      where.transferredAt = { not: null }
      where.transferredAmount = { gte: amount }
    } else if (['funding', 'overdue', 'upcoming'].includes(view)) {
      where.OR = [{ transferredAmount: null }, { transferredAmount: { lt: amount } }]
      if (view === 'funding') where.amount = { gt: 0 }
      if (view === 'overdue') where.status = BillStatus.OVERDUE
      if (view === 'upcoming') where.status = BillStatus.PENDING
    } else {
      return c.json({ error: '未知的帳單篩選' }, 400)
    }
  }

  // Unpaid is an action list — soonest deadline first (overdue dates sort
  // naturally to the top). Everything else stays a ledger, newest first.
  const orderBy = status === 'unpaid'
    ? [{ dueDate: 'asc' as const }, { id: 'asc' as const }]
    : [{ billingPeriod: 'desc' as const }, { dueDate: 'desc' as const }, { id: 'asc' as const }]

  const [bills, total] = await Promise.all([
    prisma.bill.findMany({
      where,
      include: { bank: { select: { id: true, name: true, code: true, autoDebit: true, isActive: true, bankAccountId: true } } },
      orderBy,
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.bill.count({ where }),
  ])

  return c.json({ data: bills, total, page, pageSize })
})

// Get single bill
app.get('/:id', async (c) => {
  const own = await ownBill(c, c.req.param('id'))
  if (!own) return c.json({ error: 'Bill not found' }, 404)
  const bill = await prisma.bill.findUnique({
    where: { id: own.id },
    include: {
      bank: { select: { id: true, name: true, code: true, autoDebit: true, isActive: true, bankAccountId: true } },
      notifications: { orderBy: { sentAt: 'desc' } },
    },
  })
  return c.json(bill)
})

/**
 * Derive a paidAt override for the generic PATCH /:id path ONLY. When a patch
 * flips status: entering PAID stamps paidAt (unless one is already set),
 * leaving PAID clears it. A patch that doesn't touch status leaves paidAt
 * alone. Returns the paidAt override, or undefined when no change is
 * warranted.
 *
 * /pay and /unpay intentionally do NOT call this helper — they have their own,
 * different, explicit-date semantics and routing them through here would
 * change their behavior:
 * - /pay always writes the caller-supplied (or defaulted) paidAt, even when
 *   the bill is already paid. This helper ignores explicit dates and
 *   no-ops when already paid, which would silently break the
 *   choose-your-payment-date feature (a user picking a specific paid date
 *   from a date picker).
 * - /unpay always clears paidAt unconditionally, regardless of the current
 *   value.
 * This is a deliberate three-way split, not an oversight.
 */
function paidAtForStatusChange(
  newStatus: BillStatus | undefined,
  currentPaidAt: Date | null,
): { paidAt: Date | null } | undefined {
  if (newStatus === undefined) return undefined
  if (newStatus === BillStatus.PAID) return currentPaidAt ? undefined : { paidAt: new Date() }
  return currentPaidAt ? { paidAt: null } : undefined
}

// Reopening a historical bill can only restore funding for the same debit account.
async function updateOwnedBill(
  c: Parameters<typeof getAuthUser>[0], id: string, changes: (bill: Bill) => Prisma.BillUpdateInput,
) {
  return prisma.$transaction(async (tx) => {
    const own = await tx.bill.findFirst({
      where: { id, bank: { userId: getAuthUser(c).id } }, include: { bank: { select: { bankAccountId: true } } },
    })
    if (!own) return c.json({ error: 'Bill not found' }, 404)
    const data = changes(own)
    const reopened = data.status === BillStatus.PENDING || data.status === BillStatus.OVERDUE
    if (data.status === BillStatus.NO_PAYMENT || (reopened && own.transferredAccountId !== own.bank.bankAccountId)) {
      Object.assign(data, { transferredAt: null, transferredAmount: null, transferredAccountId: null })
    }
    return c.json(await tx.bill.update({ where: { id }, data }))
  })
}

// Update bill
app.patch('/:id', zValidator('json', updateBillSchema), async (c) => {
  const data = c.req.valid('json')
  return updateOwnedBill(c, c.req.param('id'), (bill) => ({
    ...data,
    ...paidAtForStatusChange(data.status, bill.paidAt),
    ...(data.status && data.status !== BillStatus.PAID ? { paidByAutoDebit: false } : {}),
  }))
})

app.patch('/:id/transfer', zValidator('json', z.object({
  transferred: z.boolean(),
  amount: z.number().int().positive().optional(),
  bankAccountId: z.string().min(1).nullable().optional(),
})), async (c) => {
  const id = c.req.param('id')
  const { transferred, amount, bankAccountId } = c.req.valid('json')
  return prisma.$transaction(async (tx) => {
    const row = await tx.bill.findFirst({
      where: { id, bank: { userId: getAuthUser(c).id } },
      include: { bank: { select: { autoDebit: true, bankAccountId: true } } },
    })
    if (!row) return c.json({ error: 'Bill not found' }, 404)
    const { bank, ...bill } = row
    if (!unpaidStatuses.some(status => status === bill.status)) {
      return c.json({ error: '只有未結清的帳單可以變更轉帳標記' }, 409)
    }
    if (bankAccountId !== undefined && bank.bankAccountId !== bankAccountId) {
      return c.json({ error: '扣款帳戶已變更，請重新核對備款' }, 409)
    }
    if (!transferred && !bill.transferredAt && bill.transferredAmount == null) return c.json(bill)
    if (transferred) {
      // A replay from an older client has no amount and must never fund a later increase.
      if (bill.transferredAt && (amount === undefined || (bill.transferredAmount ?? 0) >= amount)) return c.json(bill)
      if (!bank.autoDebit) return c.json({ error: '只有自動扣款帳單可以標記已轉帳' }, 409)
      if (bill.amount <= 0 || (amount !== undefined && amount !== bill.amount)) {
        return c.json({ error: '應繳金額已變更，請重新核對轉帳金額' }, 409)
      }
    }
    const updated = await tx.bill.update({
      where: { id },
      data: {
        transferredAt: transferred ? bill.transferredAt ?? new Date() : null,
        transferredAmount: transferred ? bill.amount : null,
        transferredAccountId: transferred ? bank.bankAccountId : null,
      },
    })
    return c.json(updated)
  })
})

// Mark as paid
app.patch('/:id/pay', zValidator('json', z.object({
  paidAt: z.string().optional(),
}).optional()), async (c) => {
  const own = await ownBill(c, c.req.param('id'))
  if (!own) return c.json({ error: 'Bill not found' }, 404)
  const body = c.req.valid('json')
  const paidAt = body?.paidAt ? new Date(body.paidAt) : new Date()
  let paidByAutoDebit = own.paidByAutoDebit
  if (own.status !== BillStatus.PAID) {
    const bank = await prisma.bank.findUnique({ where: { id: own.bankId }, select: { autoDebit: true } })
    paidByAutoDebit = Boolean(own.transferredAt || bank?.autoDebit)
  }
  const bill = await prisma.bill.update({
    where: { id: own.id },
    data: { status: BillStatus.PAID, paidAt, paidByAutoDebit },
  })
  return c.json(bill)
})

// Revert a paid bill back to pending (undo for "標記已繳"; member-allowed)
app.post('/:id/unpay', async (c) => {
  return updateOwnedBill(c, c.req.param('id'), () => ({
    status: BillStatus.PENDING, paidAt: null, paidByAutoDebit: false,
  }))
})

// Re-parse a bill with LLM (user clicks "AI 重新解析")
app.post('/:id/reparse', async (c) => {
  const guard = await ownBill(c, c.req.param('id'))
  if (!guard) return c.json({ error: 'Bill not found' }, 404)
  const bill = await prisma.bill.findUnique({
    where: { id: guard.id },
    include: { bank: true },
  })
  if (!bill) return c.json({ error: 'Bill not found' }, 404)
  if (!bill.pdfPath) return c.json({ error: '此帳單沒有 PDF，無法重新解析' }, 400)

  const provider = await getLlmProvider()
  if (provider === LlmProvider.None) return c.json({ error: 'LLM 未設定，請先到設定啟用 Gemini 或 Ollama' }, 400)

  // Extract PDF text
  let pdfText = ''
  try {
    const filePath = path.join(DATA_DIR, bill.pdfPath)
    const buffer = await fs.readFile(filePath)
    const decrypted = await decryptPdf(buffer, getBankPdfPassword(bill.bank))
    const mupdf = await import('mupdf')
    const doc = mupdf.Document.openDocument(decrypted, 'application/pdf')
    const pages: string[] = []
    for (let i = 0; i < doc.countPages(); i++) {
      const page = doc.loadPage(i)
      pages.push(page.toStructuredText('preserve-whitespace').asText())
    }
    pdfText = pages.join('\n')
  } catch (e) {
    return c.json({ error: `PDF 讀取失敗: ${(e as Error).message}` }, 500)
  }

  let parsed
  try {
    parsed = await parseBillWithLLM(pdfText, bill.bank.name)
  } catch (e) {
    return c.json({ error: `LLM 解析失敗: ${(e as Error).message}` }, 500)
  }
  if (!parsed) return c.json({ error: 'LLM 無法解析此帳單' }, 422)

  const updated = await prisma.bill.update({
    where: { id: bill.id },
    data: {
      amount: parsed.amount,
      minimumPayment: parsed.minimumPayment,
      dueDate: parsed.dueDate,
      billingPeriod: parsed.billingPeriod,
      parseSource: 'llm',
    },
  })
  return c.json(updated)
})

// View PDF (decrypted with stored password)
app.get('/:id/pdf', async (c) => {
  const own = await ownBill(c, c.req.param('id'))
  if (!own) return c.json({ error: 'PDF not found' }, 404)
  const bill = await prisma.bill.findUnique({
    where: { id: own.id },
    include: { bank: { select: { pdfPassword: true } } },
  })
  if (!bill?.pdfPath) return c.json({ error: 'PDF not found' }, 404)

  const filePath = path.join(DATA_DIR, bill.pdfPath)
  try {
    const encrypted = await fs.readFile(filePath)
    const decrypted = await decryptPdf(encrypted, getBankPdfPassword(bill.bank))
    return new Response(new Uint8Array(decrypted), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${path.basename(bill.pdfPath)}"`,
      },
    })
  } catch (e) {
    // getBankPdfPassword/decryptSecret throws a distinct "ENCRYPTION_KEY is
    // not set but the stored value is encrypted" message when ciphertext
    // exists but the key to read it is gone — surface that operator
    // misconfiguration instead of the generic (and here misleading) 404.
    const message = (e as Error).message
    if (message.includes('ENCRYPTION_KEY')) return c.json({ error: message }, 500)
    return c.json({ error: 'PDF file missing' }, 404)
  }
})

// Delete bill
app.delete('/:id', async (c) => {
  const bill = await ownBill(c, c.req.param('id'))
  if (!bill) return c.json({ error: 'Not found' }, 404)
  // notification logs cascade via the schema FK
  await prisma.bill.delete({ where: { id: bill.id } })
  return c.json({ success: true })
})

export default app
