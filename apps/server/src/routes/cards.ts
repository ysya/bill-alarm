import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import prisma from '../db/prisma.js'

const app = new Hono()

const createCardSchema = z.object({
  bankName: z.string().min(1),
  emailSenderPattern: z.string().min(1),
  emailSubjectPattern: z.string().min(1),
  pdfPassword: z.string().optional(),
  isActive: z.boolean().optional(),
})

const updateCardSchema = createCardSchema.partial()

// List all cards
app.get('/', async (c) => {
  const cards = await prisma.creditCard.findMany({
    include: { _count: { select: { bills: true } } },
    orderBy: { createdAt: 'desc' },
  })
  return c.json(cards)
})

// Get single card
app.get('/:id', async (c) => {
  const card = await prisma.creditCard.findUnique({
    where: { id: c.req.param('id') },
    include: { bills: { orderBy: { dueDate: 'desc' }, take: 12 } },
  })
  if (!card) return c.json({ error: 'Card not found' }, 404)
  return c.json(card)
})

// Create card
app.post('/', zValidator('json', createCardSchema), async (c) => {
  const data = c.req.valid('json')
  const card = await prisma.creditCard.create({ data })
  return c.json(card, 201)
})

// Update card
app.patch('/:id', zValidator('json', updateCardSchema), async (c) => {
  const data = c.req.valid('json')
  const card = await prisma.creditCard.update({
    where: { id: c.req.param('id') },
    data,
  })
  return c.json(card)
})

// Delete card
app.delete('/:id', async (c) => {
  await prisma.creditCard.delete({ where: { id: c.req.param('id') } })
  return c.json({ success: true })
})

export default app
