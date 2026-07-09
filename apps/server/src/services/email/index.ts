import { GmailImapProvider } from './providers/gmail-imap.js'
import { decryptSecret } from '@/services/secrets.js'
import type { EmailProvider } from './types.js'

export type { EmailProvider, EmailMessage, Attachment, MessageRef, SearchCriteria, VerifyResult } from './types.js'

export interface MailboxOwner {
  imapHost: string | null
  imapPort: number | null
  imapUser: string | null
  imapPassword: string | null
}

/**
 * Build a provider from a user's own mailbox fields. Null until user+password
 * are set. The single choke point for all mailbox use (routes/email.ts,
 * routes/parser-lab.ts, services/email-parser.ts all go through this) —
 * decrypting here means none of those call sites need to know imapPassword
 * is encrypted at rest. Throws if imapPassword is `enc:v1:`-encrypted but
 * ENCRYPTION_KEY is no longer configured (see services/secrets.ts).
 */
export function getEmailProviderFor(owner: MailboxOwner): EmailProvider | null {
  if (!owner.imapUser || !owner.imapPassword) return null
  return new GmailImapProvider({
    host: owner.imapHost || 'imap.gmail.com',
    port: owner.imapPort || 993,
    user: owner.imapUser,
    password: decryptSecret(owner.imapPassword),
  })
}

export async function verifyConnectionFor(owner: MailboxOwner): Promise<{ connected: boolean; message: string; email?: string }> {
  const provider = getEmailProviderFor(owner)
  if (!provider) return { connected: false, message: '信箱尚未設定' }
  const result = await provider.verify()
  if (!result.ok) return { connected: false, message: `連線失敗：${result.error}` }
  return { connected: true, message: `已連線：${result.email}`, email: result.email }
}
