import { Hono } from 'hono'
import { verifyConnectionFor } from '@/services/email/index.js'
import prisma from '@/prisma.js'
import { sendTestMessage, isConfigured as telegramConfigured } from '@/services/telegram.js'
import { getAuthUser } from './auth.js'

const app = new Hono()

async function currentUser(c: Parameters<typeof getAuthUser>[0]) {
  return prisma.user.findUnique({ where: { id: getAuthUser(c).id } })
}

// Telegram test — sends to the requester's own binding
app.post('/telegram/test', async (c) => {
  const authUser = getAuthUser(c)
  const user = await prisma.user.findUnique({ where: { id: authUser.id } })
  if (!user?.telegramChatId) return c.json({ error: '請先在帳號區綁定 Telegram' }, 400)
  const success = await sendTestMessage(user.telegramChatId)
  return c.json({ success })
})

// Setup progress for the dashboard checklist — cheap DB reads only, no live
// IMAP probe. botConfigured is system-wide (visible to members: they need to
// know whether binding can work at all); the rest is self-scoped.
app.get('/onboarding-status', async (c) => {
  const me = await currentUser(c)
  const hasActiveBank = me
    ? (await prisma.bank.count({ where: { userId: me.id, isActive: true } })) > 0
    : false
  return c.json({
    emailConfigured: !!(me?.imapUser && me?.imapPassword),
    hasActiveBank,
    botConfigured: await telegramConfigured(),
    telegramBound: !!me?.telegramChatId,
  })
})

// Integration status overview
app.get('/integrations/status', async (c) => {
  const me = await currentUser(c)
  const email = (me?.imapUser && me?.imapPassword)
    ? await verifyConnectionFor(me)
    : { connected: false, message: '信箱尚未設定' }
  return c.json({
    email: { connected: email.connected, message: email.message },
    telegram: { configured: await telegramConfigured() },
  })
})

export default app
