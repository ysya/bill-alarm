import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import prisma from '@/prisma.js'

const app = new Hono()

const ruleSchema = z.object({
  name: z.string().min(1),
  daysBefore: z.number().int().min(0),
  timeOfDay: z.string().regex(/^\d{2}:\d{2}$/),
  channels: z.array(z.enum(['telegram', 'calendar'])).min(1),
  isActive: z.boolean().optional(),
})

const updateRuleSchema = ruleSchema.partial()

// List all rules
app.get('/', async (c) => {
  const rules = await prisma.notificationRule.findMany({
    orderBy: { daysBefore: 'desc' },
  })
  return c.json(rules.map((r) => ({ ...r, channels: JSON.parse(r.channels) })))
})

// Create rule
app.post('/', zValidator('json', ruleSchema), async (c) => {
  const data = c.req.valid('json')
  const rule = await prisma.notificationRule.create({
    data: { ...data, channels: JSON.stringify(data.channels) },
  })
  return c.json({ ...rule, channels: data.channels }, 201)
})

// Update rule
app.patch('/:id', zValidator('json', updateRuleSchema), async (c) => {
  const data = c.req.valid('json')
  const updateData: Record<string, unknown> = { ...data }
  if (data.channels) updateData.channels = JSON.stringify(data.channels)

  const rule = await prisma.notificationRule.update({
    where: { id: c.req.param('id') },
    data: updateData,
  })
  return c.json({ ...rule, channels: JSON.parse(rule.channels) })
})

// Delete rule
app.delete('/:id', async (c) => {
  await prisma.notificationRule.delete({ where: { id: c.req.param('id') } })
  return c.json({ success: true })
})

export default app
