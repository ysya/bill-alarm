import { getSetting, KEYS } from '../settings.js'
import { GmailImapProvider, type GmailImapConfig } from './providers/gmail-imap.js'
import type { EmailProvider, EmailProviderName } from './types.js'

export type { EmailProvider, EmailMessage, Attachment, MessageRef, SearchOptions, VerifyResult } from './types.js'

const DEFAULT_PROVIDER: EmailProviderName = 'gmail-imap'

export async function getEmailProviderName(): Promise<EmailProviderName> {
  const v = await getSetting(KEYS.EMAIL_PROVIDER)
  return (v as EmailProviderName) || DEFAULT_PROVIDER
}

async function loadGmailImapConfig(): Promise<GmailImapConfig | null> {
  const host = (await getSetting(KEYS.IMAP_HOST)) || 'imap.gmail.com'
  const portRaw = (await getSetting(KEYS.IMAP_PORT)) || '993'
  const user = await getSetting(KEYS.IMAP_USER)
  const password = await getSetting(KEYS.IMAP_PASSWORD)

  if (!user || !password) return null
  const port = parseInt(portRaw, 10) || 993
  return { host, port, user, password }
}

export async function getEmailProvider(): Promise<EmailProvider | null> {
  const name = await getEmailProviderName()
  switch (name) {
    case 'gmail-imap': {
      const cfg = await loadGmailImapConfig()
      if (!cfg) return null
      return new GmailImapProvider(cfg)
    }
    default:
      throw new Error(`Unknown email provider: ${name}`)
  }
}

export async function isConfigured(): Promise<boolean> {
  return (await getEmailProvider()) !== null
}

export async function verifyConnection(): Promise<{ connected: boolean; message: string; email?: string }> {
  const provider = await getEmailProvider()
  if (!provider) return { connected: false, message: '信箱尚未設定' }
  const result = await provider.verify()
  if (!result.ok) return { connected: false, message: `連線失敗：${result.error}` }
  return { connected: true, message: `已連線：${result.email}`, email: result.email }
}
