import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import prisma from '@/prisma.js'
import { hashPassword, destroyUserSessions } from '@/services/auth.js'
import { credsSchema, passwordSchema } from './auth.js'

// Admin-only by construction: /api/users/* is not in the member allow-list,
// so authGuard rejects members before these handlers run.
const app = new Hono()

function toDTO(u: { id: string; username: string; role: string; telegramChatId: string | null; createdAt: Date }) {
  return { id: u.id, username: u.username, role: u.role, telegramBound: !!u.telegramChatId, createdAt: u.createdAt }
}

app.get('/', async (c) => {
  const users = await prisma.user.findMany({ orderBy: { createdAt: 'asc' } })
  return c.json(users.map(toDTO))
})

app.post('/', zValidator('json', credsSchema), async (c) => {
  const { username, password } = c.req.valid('json')
  const existing = await prisma.user.findUnique({ where: { username } })
  if (existing) return c.json({ error: '帳號名稱已存在' }, 409)
  const user = await prisma.user.create({
    data: { username, passwordHash: hashPassword(password), role: 'member' },
  })
  return c.json(toDTO(user), 201)
})

app.post('/:id/reset-password', zValidator('json', z.object({ password: passwordSchema })), async (c) => {
  const user = await prisma.user.findUnique({ where: { id: c.req.param('id') } })
  if (!user) return c.json({ error: '找不到使用者' }, 404)
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: hashPassword(c.req.valid('json').password) },
  })
  await destroyUserSessions(user.id)
  return c.json({ ok: true })
})

app.delete('/:id', async (c) => {
  const user = await prisma.user.findUnique({ where: { id: c.req.param('id') } })
  if (!user) return c.json({ error: '找不到使用者' }, 404)
  if (user.role === 'admin') return c.json({ error: '無法刪除管理員帳號' }, 400)
  await prisma.user.delete({ where: { id: user.id } }) // sessions cascade
  return c.json({ ok: true })
})

export default app
