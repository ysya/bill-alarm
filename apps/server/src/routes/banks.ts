import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import prisma from '@/prisma.js'
import { BANK_PRESETS } from '@bill-alarm/shared/constants'

const app = new Hono()

// List presets
app.get('/presets', (c) => {
  return c.json(BANK_PRESETS)
})

// List user's enabled banks (DB records)
app.get('/', async (c) => {
  const banks = await prisma.bank.findMany({
    include: { _count: { select: { bills: true } } },
    orderBy: { name: 'asc' },
  })
  return c.json(banks)
})

// Enable a preset bank
app.post('/enable/:code', zValidator('json', z.object({
  pdfPassword: z.string().optional(),
}).optional()), async (c) => {
  const code = c.req.param('code')
  const preset = BANK_PRESETS.find((p) => p.code === code)
  if (!preset) return c.json({ error: 'Unknown bank code' }, 404)

  const existing = await prisma.bank.findUnique({ where: { code } })
  if (existing) {
    const updated = await prisma.bank.update({
      where: { code },
      data: { isActive: true },
    })
    return c.json(updated)
  }

  const body = c.req.valid('json')
  const bank = await prisma.bank.create({
    data: {
      code,
      name: preset.name,
      emailSenderPattern: preset.emailSender,
      emailSubjectPattern: preset.emailSubject,
      pdfPassword: body?.pdfPassword,
      isBuiltin: true,
      isActive: true,
    },
  })
  return c.json(bank, 201)
})

// Disable a bank
app.post('/disable/:code', async (c) => {
  const code = c.req.param('code')
  const bank = await prisma.bank.findUnique({ where: { code } })
  if (!bank) return c.json({ error: 'Not found' }, 404)
  const updated = await prisma.bank.update({
    where: { code },
    data: { isActive: false },
  })
  return c.json(updated)
})

// Update bank settings
app.patch('/:id', zValidator('json', z.object({
  name: z.string().min(1).optional(),
  emailSenderPattern: z.string().min(1).optional(),
  emailSubjectPattern: z.string().min(1).optional(),
  pdfPassword: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
})), async (c) => {
  const data = c.req.valid('json')
  const bank = await prisma.bank.update({
    where: { id: c.req.param('id') },
    data,
  })
  return c.json(bank)
})

// Add custom bank
app.post('/', zValidator('json', z.object({
  name: z.string().min(1),
  emailSenderPattern: z.string().min(1),
  emailSubjectPattern: z.string().min(1),
  pdfPassword: z.string().optional(),
})), async (c) => {
  const data = c.req.valid('json')
  const bank = await prisma.bank.create({
    data: { ...data, isBuiltin: false, isActive: true },
  })
  return c.json(bank, 201)
})

// Delete custom bank only
app.delete('/:id', async (c) => {
  const bank = await prisma.bank.findUnique({ where: { id: c.req.param('id') } })
  if (!bank) return c.json({ error: 'Not found' }, 404)
  if (bank.isBuiltin) return c.json({ error: '無法刪除內建銀行，請改為停用' }, 400)
  await prisma.bank.delete({ where: { id: bank.id } })
  return c.json({ success: true })
})

export default app
