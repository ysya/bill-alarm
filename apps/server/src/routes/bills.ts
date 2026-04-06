import fs from 'node:fs/promises'
import path from 'node:path'
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import prisma from '@/prisma.js'
import { handleBillPaid } from '@/services/notification.js'
import { DATA_DIR } from '@/paths.js'
import { decryptPdf } from '@/services/pdf-parser.js'
import { BillStatus } from '@bill-alarm/shared/types'

const app = new Hono()

const updateBillSchema = z.object({
  amount: z.number().int().optional(),
  minimumPayment: z.number().int().positive().nullable().optional(),
  dueDate: z.string().datetime().optional(),
  status: z.enum([BillStatus.PENDING, BillStatus.PAID, BillStatus.OVERDUE]).optional(),
})

// Dashboard summary
app.get('/summary', async (c) => {
  const month = c.req.query('month')
  const now = new Date()
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

  const [pending, paid, overdue] = await Promise.all([
    prisma.bill.findMany({ where: { status: BillStatus.PENDING } }),
    prisma.bill.count({ where: { status: BillStatus.PAID, billingPeriod: currentMonth } }),
    prisma.bill.count({ where: { status: BillStatus.OVERDUE } }),
  ])

  const totalPending = pending.reduce((sum, b) => sum + b.amount, 0)
  const upcomingBills = pending
    .filter((b) => b.dueDate >= now)
    .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime())

  const result: Record<string, unknown> = {
    totalPending,
    pendingCount: pending.length,
    paidCount: paid,
    overdueCount: overdue,
    nextDueDate: upcomingBills[0]?.dueDate ?? null,
  }

  if (month) {
    const monthBills = await prisma.bill.findMany({
      where: { billingPeriod: month },
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
    result.timeline = monthBills.map((b) => ({
      id: b.id,
      bankName: b.bank.name,
      amount: b.amount,
      dueDate: b.dueDate,
      status: b.status,
      autoDebit: b.bank.autoDebit,
    }))
  }

  return c.json(result)
})

// List bills with filters + pagination
app.get('/', async (c) => {
  const { status, bankId } = c.req.query()
  const page = Math.max(1, Number(c.req.query('page')) || 1)
  const pageSize = Math.min(100, Math.max(1, Number(c.req.query('pageSize')) || 20))

  const where: Record<string, unknown> = {}
  if (status) where.status = status
  if (bankId) where.bankId = bankId

  const [bills, total] = await Promise.all([
    prisma.bill.findMany({
      where,
      include: { bank: { select: { name: true } } },
      orderBy: [{ dueDate: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.bill.count({ where }),
  ])

  return c.json({ data: bills, total, page, pageSize })
})

// Get single bill
app.get('/:id', async (c) => {
  const bill = await prisma.bill.findUnique({
    where: { id: c.req.param('id') },
    include: {
      bank: true,
      notifications: { orderBy: { sentAt: 'desc' } },
    },
  })
  if (!bill) return c.json({ error: 'Bill not found' }, 404)
  return c.json(bill)
})

// Update bill
app.patch('/:id', zValidator('json', updateBillSchema), async (c) => {
  const data = c.req.valid('json')
  const updateData: Record<string, unknown> = { ...data }
  if (data.dueDate) updateData.dueDate = new Date(data.dueDate)

  const bill = await prisma.bill.update({
    where: { id: c.req.param('id') },
    data: updateData,
  })
  return c.json(bill)
})

// Mark as paid
app.patch('/:id/pay', zValidator('json', z.object({
  paidAt: z.string().optional(),
}).optional()), async (c) => {
  const body = c.req.valid('json')
  const paidAt = body?.paidAt ? new Date(body.paidAt) : new Date()
  const bill = await prisma.bill.update({
    where: { id: c.req.param('id') },
    data: { status: BillStatus.PAID, paidAt },
  })
  // Remove calendar event
  await handleBillPaid(bill.id)
  return c.json(bill)
})

// View PDF (decrypted with stored password)
app.get('/:id/pdf', async (c) => {
  const bill = await prisma.bill.findUnique({
    where: { id: c.req.param('id') },
    include: { bank: { select: { pdfPassword: true } } },
  })
  if (!bill?.pdfPath) return c.json({ error: 'PDF not found' }, 404)

  const filePath = path.join(DATA_DIR, bill.pdfPath)
  try {
    const encrypted = await fs.readFile(filePath)
    const password = bill.bank.pdfPassword || undefined
    const decrypted = await decryptPdf(encrypted, password)
    return new Response(decrypted, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${path.basename(bill.pdfPath)}"`,
      },
    })
  } catch {
    return c.json({ error: 'PDF file missing' }, 404)
  }
})

// Delete bill
app.delete('/:id', async (c) => {
  const bill = await prisma.bill.findUnique({ where: { id: c.req.param('id') } })
  if (!bill) return c.json({ error: 'Not found' }, 404)
  await prisma.notificationLog.deleteMany({ where: { billId: bill.id } })
  await prisma.bill.delete({ where: { id: bill.id } })
  return c.json({ success: true })
})

export default app
