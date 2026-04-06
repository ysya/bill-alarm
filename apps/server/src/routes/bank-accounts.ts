import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import prisma from '@/prisma.js'

const app = new Hono()

app.get('/', async (c) => {
  const accounts = await prisma.bankAccount.findMany({
    orderBy: { name: 'asc' },
  })
  return c.json(accounts)
})

app.post('/', zValidator('json', z.object({
  name: z.string().min(1),
  bankName: z.string().min(1),
  note: z.string().optional(),
})), async (c) => {
  const data = c.req.valid('json')
  const account = await prisma.bankAccount.create({ data })
  return c.json(account, 201)
})

app.patch('/:id', zValidator('json', z.object({
  name: z.string().min(1).optional(),
  bankName: z.string().min(1).optional(),
  note: z.string().nullable().optional(),
})), async (c) => {
  const data = c.req.valid('json')
  const account = await prisma.bankAccount.update({
    where: { id: c.req.param('id') },
    data,
  })
  return c.json(account)
})

app.delete('/:id', async (c) => {
  const id = c.req.param('id')
  const usedBy = await prisma.bank.count({ where: { bankAccountId: id } })
  if (usedBy > 0) {
    return c.json({ error: '此帳戶仍被銀行使用中，請先解除關聯' }, 400)
  }
  await prisma.bankAccount.delete({ where: { id } })
  return c.json({ success: true })
})

export default app
