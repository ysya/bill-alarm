import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import prisma from '@/prisma.js'
import { GmailImapProvider } from '@/services/email/providers/gmail-imap.js'
import { verifyConnectionFor } from '@/services/email/index.js'
import { getAuthUser } from './auth.js'

const app = new Hono()

const imapConfigSchema = z.object({
  host: z.string().min(1).default('imap.gmail.com'),
  port: z.number().int().min(1).max(65535).default(993),
  user: z.string().min(1),
  password: z.string().min(1),
})

// Test connection with provided IMAP credentials (does not save)
app.post('/test', zValidator('json', imapConfigSchema), async (c) => {
  const cfg = c.req.valid('json')
  const provider = new GmailImapProvider(cfg)
  const result = await provider.verify()
  return c.json(result)
})

// Save the CURRENT user's mailbox config
app.post('/save', zValidator('json', imapConfigSchema.extend({
  provider: z.literal('gmail-imap').default('gmail-imap'),
})), async (c) => {
  const { host, port, user, password } = c.req.valid('json')
  await prisma.user.update({
    where: { id: getAuthUser(c).id },
    data: { imapHost: host, imapPort: port, imapUser: user, imapPassword: password },
  })
  return c.json({ success: true })
})

// Current user's mailbox config + live connection status
app.get('/status', async (c) => {
  const me = await prisma.user.findUnique({ where: { id: getAuthUser(c).id } })
  if (!me) return c.json({ error: 'unauthorized' }, 401)
  const hasCredentials = !!(me.imapUser && me.imapPassword)
  const conn = hasCredentials
    ? await verifyConnectionFor(me)
    : { connected: false, message: '信箱尚未設定' }
  return c.json({
    hasCredentials,
    connected: conn.connected,
    message: conn.message,
    email: conn.email,
    host: me.imapHost || 'imap.gmail.com',
    port: me.imapPort || 993,
    user: me.imapUser,
  })
})

export default app
