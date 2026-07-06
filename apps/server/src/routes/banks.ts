import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import prisma from '@/prisma.js'
import { BANK_PRESETS } from '@bill-alarm/shared/constants'
import { getAuthUser } from './auth.js'

const app = new Hono()

// List presets
app.get('/presets', (c) => {
  return c.json(BANK_PRESETS)
})

app.get('/', async (c) => {
  const banks = await prisma.bank.findMany({
    where: { userId: getAuthUser(c).id },
    include: { _count: { select: { bills: true } }, bankAccount: true },
    orderBy: { name: 'asc' },
  })
  return c.json(banks)
})

app.post('/enable/:code', zValidator('json', z.object({
  pdfPassword: z.string().optional(),
}).optional()), async (c) => {
  const userId = getAuthUser(c).id
  const code = c.req.param('code')
  const preset = BANK_PRESETS.find((p) => p.code === code)
  if (!preset) return c.json({ error: 'Unknown bank code' }, 404)

  const existing = await prisma.bank.findFirst({ where: { userId, code } })
  if (existing) {
    const updated = await prisma.bank.update({
      where: { id: existing.id },
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
      userId,
    },
  })
  return c.json(bank, 201)
})

app.post('/disable/:code', async (c) => {
  const bank = await prisma.bank.findFirst({ where: { userId: getAuthUser(c).id, code: c.req.param('code') } })
  if (!bank) return c.json({ error: 'Not found' }, 404)
  const updated = await prisma.bank.update({
    where: { id: bank.id },
    data: { isActive: false },
  })
  return c.json(updated)
})

app.patch('/:id', zValidator('json', z.object({
  name: z.string().min(1).optional(),
  emailSenderPattern: z.string().min(1).optional(),
  emailSubjectPattern: z.string().min(1).optional(),
  pdfPassword: z.string().nullable().optional(),
  parserConfig: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
  autoDebit: z.boolean().optional(),
  bankAccountId: z.string().nullable().optional(),
})), async (c) => {
  const userId = getAuthUser(c).id
  const existing = await prisma.bank.findFirst({ where: { id: c.req.param('id'), userId } })
  if (!existing) return c.json({ error: 'Not found' }, 404)
  const data = c.req.valid('json')
  if (data.bankAccountId) {
    const account = await prisma.bankAccount.findFirst({ where: { id: data.bankAccountId, userId } })
    if (!account) return c.json({ error: '找不到帳戶' }, 404)
  }
  const bank = await prisma.bank.update({ where: { id: existing.id }, data })
  return c.json(bank)
})

app.post('/', zValidator('json', z.object({
  name: z.string().min(1),
  emailSenderPattern: z.string().min(1),
  emailSubjectPattern: z.string().min(1),
  pdfPassword: z.string().optional(),
})), async (c) => {
  const data = c.req.valid('json')
  const bank = await prisma.bank.create({
    data: { ...data, isBuiltin: false, isActive: true, userId: getAuthUser(c).id },
  })
  return c.json(bank, 201)
})

app.delete('/:id', async (c) => {
  const bank = await prisma.bank.findFirst({ where: { id: c.req.param('id'), userId: getAuthUser(c).id } })
  if (!bank) return c.json({ error: 'Not found' }, 404)
  if (bank.isBuiltin) return c.json({ error: '無法刪除內建銀行，請改為停用' }, 400)
  await prisma.bank.delete({ where: { id: bank.id } })
  return c.json({ success: true })
})

export default app
