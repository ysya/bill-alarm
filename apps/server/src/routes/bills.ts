import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import prisma from '../db/prisma.js'
import { handleBillPaid } from '../services/notification.js'

const app = new Hono()

const updateBillSchema = z.object({
  amount: z.number().int().positive().optional(),
  minimumPayment: z.number().int().positive().nullable().optional(),
  dueDate: z.string().datetime().optional(),
  status: z.enum(['pending', 'paid', 'overdue']).optional(),
})

// Dashboard summary
app.get('/summary', async (c) => {
  const now = new Date()
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

  const [pending, paid, overdue] = await Promise.all([
    prisma.bill.findMany({ where: { status: 'pending' } }),
    prisma.bill.count({ where: { status: 'paid', billingPeriod: currentMonth } }),
    prisma.bill.count({ where: { status: 'overdue' } }),
  ])

  const totalPending = pending.reduce((sum, b) => sum + b.amount, 0)
  const upcomingBills = pending
    .filter((b) => b.dueDate >= now)
    .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime())

  return c.json({
    totalPending,
    pendingCount: pending.length,
    paidCount: paid,
    overdueCount: overdue,
    nextDueDate: upcomingBills[0]?.dueDate ?? null,
  })
})

// List bills with filters
app.get('/', async (c) => {
  const { status, month, bankId } = c.req.query()

  const where: Record<string, unknown> = {}
  if (status) where.status = status
  if (month) where.billingPeriod = month
  if (bankId) where.bankId = bankId

  const bills = await prisma.bill.findMany({
    where,
    include: { bank: { select: { name: true } } },
    orderBy: { dueDate: 'asc' },
  })
  return c.json(bills)
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
app.patch('/:id/pay', async (c) => {
  const bill = await prisma.bill.update({
    where: { id: c.req.param('id') },
    data: { status: 'paid', paidAt: new Date() },
  })
  // Remove calendar event
  await handleBillPaid(bill.id)
  return c.json(bill)
})

export default app
