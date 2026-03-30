import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import prisma from '../db/prisma.js'
import { BANK_PRESETS } from '@bill-alarm/shared/constants'

const app = new Hono()

// List presets + user's enabled banks
app.get('/presets', (c) => {
  return c.json(BANK_PRESETS)
})

// List user's enabled banks (DB records)
app.get('/', async (c) => {
  const cards = await prisma.creditCard.findMany({
    include: { _count: { select: { bills: true } } },
    orderBy: { bankName: 'asc' },
  })
  return c.json(cards)
})

// Enable a preset bank (creates DB record from preset)
app.post('/enable/:code', zValidator('json', z.object({
  pdfPassword: z.string().optional(),
}).optional()), async (c) => {
  const code = c.req.param('code')
  const preset = BANK_PRESETS.find((p) => p.code === code)
  if (!preset) return c.json({ error: 'Unknown bank code' }, 404)

  // Check if already exists
  const existing = await prisma.creditCard.findUnique({ where: { code } })
  if (existing) {
    const updated = await prisma.creditCard.update({
      where: { code },
      data: { isActive: true },
    })
    return c.json(updated)
  }

  const body = c.req.valid('json')
  const card = await prisma.creditCard.create({
    data: {
      code,
      bankName: preset.name,
      emailSenderPattern: preset.emailSender,
      emailSubjectPattern: preset.emailSubject,
      pdfPassword: body?.pdfPassword,
      isBuiltin: true,
      isActive: true,
    },
  })
  return c.json(card, 201)
})

// Disable a bank
app.post('/disable/:code', async (c) => {
  const code = c.req.param('code')
  const card = await prisma.creditCard.findUnique({ where: { code } })
  if (!card) return c.json({ error: 'Not found' }, 404)
  const updated = await prisma.creditCard.update({
    where: { code },
    data: { isActive: false },
  })
  return c.json(updated)
})

// Update bank settings (password, email patterns)
app.patch('/:id', zValidator('json', z.object({
  bankName: z.string().min(1).optional(),
  emailSenderPattern: z.string().min(1).optional(),
  emailSubjectPattern: z.string().min(1).optional(),
  pdfPassword: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
})), async (c) => {
  const data = c.req.valid('json')
  const card = await prisma.creditCard.update({
    where: { id: c.req.param('id') },
    data,
  })
  return c.json(card)
})

// Add custom bank
app.post('/', zValidator('json', z.object({
  bankName: z.string().min(1),
  emailSenderPattern: z.string().min(1),
  emailSubjectPattern: z.string().min(1),
  pdfPassword: z.string().optional(),
})), async (c) => {
  const data = c.req.valid('json')
  const card = await prisma.creditCard.create({
    data: { ...data, isBuiltin: false, isActive: true },
  })
  return c.json(card, 201)
})

// Delete custom bank only
app.delete('/:id', async (c) => {
  const card = await prisma.creditCard.findUnique({ where: { id: c.req.param('id') } })
  if (!card) return c.json({ error: 'Not found' }, 404)
  if (card.isBuiltin) return c.json({ error: '無法刪除內建銀行，請改為停用' }, 400)
  await prisma.creditCard.delete({ where: { id: card.id } })
  return c.json({ success: true })
})

export default app
