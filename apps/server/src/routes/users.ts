import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import prisma from '@/prisma.js'
import { hashPassword, destroyUserSessions } from '@/services/auth.js'
import { adminOnly } from '@/middleware/admin-only.js'
import { credsSchema, passwordSchema } from './auth.js'

// Admin-only: every route in this router requires adminOnly (mounted below),
// so authGuard alone is not enough — non-admins are 403'd before handlers run.
const app = new Hono()
app.use('*', adminOnly)

function toDTO(u: { id: string; username: string; role: string; telegramChatId: string | null; imapUser: string | null; imapPassword: string | null; deletedAt: Date | null; createdAt: Date }) {
  return {
    id: u.id,
    username: u.username,
    role: u.role,
    telegramBound: !!u.telegramChatId,
    emailConfigured: !!(u.imapUser && u.imapPassword),
    deletedAt: u.deletedAt,
    createdAt: u.createdAt,
  }
}

app.get('/', async (c) => {
  const users = await prisma.user.findMany({ orderBy: { createdAt: 'asc' } })
  return c.json(users.map(toDTO))
})

app.post('/', zValidator('json', credsSchema), async (c) => {
  const { username, password } = c.req.valid('json')
  const existing = await prisma.user.findUnique({ where: { username } })
  if (existing) return c.json({ error: '帳號名稱已存在' }, 409)
  try {
    const user = await prisma.user.create({
      data: { username, passwordHash: await hashPassword(password), role: 'member' },
    })
    return c.json(toDTO(user), 201)
  } catch (e) {
    // Unique-constraint race with a concurrent create (double-submit): map to
    // the same 409 as the pre-check so the HTTP contract holds under concurrency.
    if ((e as { code?: string }).code === 'P2002') {
      return c.json({ error: '帳號名稱已存在' }, 409)
    }
    throw e
  }
})

app.post('/:id/reset-password', zValidator('json', z.object({ password: passwordSchema })), async (c) => {
  const user = await prisma.user.findUnique({ where: { id: c.req.param('id') } })
  if (!user) return c.json({ error: '找不到使用者' }, 404)
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(c.req.valid('json').password) },
  })
  await destroyUserSessions(user.id)
  return c.json({ ok: true })
})

// Deactivate (soft delete): data preserved, login/session/cron/notifications disabled
app.delete('/:id', async (c) => {
  const user = await prisma.user.findUnique({ where: { id: c.req.param('id') } })
  if (!user) return c.json({ error: '找不到使用者' }, 404)
  if (user.role === 'admin') return c.json({ error: '無法停用管理員帳號' }, 400)
  await prisma.user.update({ where: { id: user.id }, data: { deletedAt: new Date() } })
  await destroyUserSessions(user.id)
  return c.json({ ok: true })
})

app.post('/:id/restore', async (c) => {
  const user = await prisma.user.findUnique({ where: { id: c.req.param('id') } })
  if (!user) return c.json({ error: '找不到使用者' }, 404)
  await prisma.user.update({ where: { id: user.id }, data: { deletedAt: null } })
  return c.json({ ok: true })
})

// Permanent delete: only from the deactivated state, wipes all tenant data
app.delete('/:id/permanent', async (c) => {
  const user = await prisma.user.findUnique({ where: { id: c.req.param('id') } })
  if (!user) return c.json({ error: '找不到使用者' }, 404)
  if (user.role === 'admin') return c.json({ error: '無法刪除管理員帳號' }, 400)
  if (!user.deletedAt) return c.json({ error: '請先停用帳號' }, 400)
  // user delete cascades: banks -> bills -> notification logs,
  // plus bankAccounts / notificationRules / scanLogs / sessions.
  await prisma.user.delete({ where: { id: user.id } })
  return c.json({ ok: true })
})

export default app
