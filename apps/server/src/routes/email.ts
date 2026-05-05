import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { setSetting, KEYS } from '@/services/settings.js'
import { GmailImapProvider } from '@/services/email/providers/gmail-imap.js'
import { verifyConnection } from '@/services/email/index.js'

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

// Save IMAP config (and optionally provider name)
app.post('/save', zValidator('json', imapConfigSchema.extend({
  provider: z.literal('gmail-imap').default('gmail-imap'),
})), async (c) => {
  const { provider, host, port, user, password } = c.req.valid('json')
  await setSetting(KEYS.EMAIL_PROVIDER, provider)
  await setSetting(KEYS.IMAP_HOST, host)
  await setSetting(KEYS.IMAP_PORT, String(port))
  await setSetting(KEYS.IMAP_USER, user)
  await setSetting(KEYS.IMAP_PASSWORD, password)
  return c.json({ success: true })
})

// Live status (after save)
app.get('/status', async (c) => {
  const status = await verifyConnection()
  return c.json(status)
})

export default app
