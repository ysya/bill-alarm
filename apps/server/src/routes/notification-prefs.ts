import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import prisma from '@/prisma.js'
import { getAuthUser } from './auth.js'
import { DEFAULT_PREFS, getEffectivePrefs, normalizeRemindDays } from '@/services/notification-prefs.js'

const app = new Hono()

const prefsSchema = z.object({
  remindDays: z.array(z.number().int().min(0).max(30)).max(6),
  remindTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  notifyNewBill: z.boolean(),
  notifyOverdue: z.boolean(),
})

/** Latest delivery attempt for any bill the user owns — surfaces silent failures. */
async function lastDeliveryFor(userId: string) {
  return prisma.notificationLog.findFirst({
    where: { bill: { bank: { userId } } },
    orderBy: { sentAt: 'desc' },
    select: { sentAt: true, success: true, message: true, errorMessage: true },
  })
}

app.get('/', async (c) => {
  const userId = getAuthUser(c).id
  const existing = await prisma.notificationPreference.findUnique({ where: { userId } })
  if (!existing) {
    // Lazy-create so subsequent PUTs are plain updates; the unique(userId)
    // race from concurrent GETs is benign — swallow it and read back.
    await prisma.notificationPreference.create({
      data: { userId, remindDays: JSON.stringify(DEFAULT_PREFS.remindDays), remindTime: DEFAULT_PREFS.remindTime },
    }).catch(() => {})
  }
  const prefs = await getEffectivePrefs(userId)
  return c.json({ ...prefs, lastDelivery: await lastDeliveryFor(userId) })
})

app.put('/', zValidator('json', prefsSchema), async (c) => {
  const userId = getAuthUser(c).id
  const data = c.req.valid('json')
  const remindDays = normalizeRemindDays(data.remindDays)
  const fields = {
    remindDays: JSON.stringify(remindDays),
    remindTime: data.remindTime,
    notifyNewBill: data.notifyNewBill,
    notifyOverdue: data.notifyOverdue,
  }
  await prisma.notificationPreference.upsert({ where: { userId }, create: { userId, ...fields }, update: fields })
  return c.json({ remindDays, remindTime: data.remindTime, notifyNewBill: data.notifyNewBill, notifyOverdue: data.notifyOverdue })
})

export default app
