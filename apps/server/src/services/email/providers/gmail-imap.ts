import { ImapFlow, type ImapFlowOptions } from 'imapflow'
import { simpleParser } from 'mailparser'
import type {
  EmailProvider,
  EmailMessage,
  EmailSession,
  MessageRef,
  SearchOptions,
  VerifyResult,
  Attachment,
} from '../types.js'

export interface GmailImapConfig {
  host: string
  port: number
  user: string
  password: string
}

export class GmailImapProvider implements EmailProvider {
  readonly name = 'gmail-imap'

  constructor(private config: GmailImapConfig) {}

  private buildOptions(): ImapFlowOptions {
    return {
      host: this.config.host,
      port: this.config.port,
      secure: this.config.port === 993,
      auth: { user: this.config.user, pass: this.config.password },
      logger: false,
    }
  }

  async verify(): Promise<VerifyResult> {
    const client = new ImapFlow(this.buildOptions())
    try {
      await client.connect()
      return { ok: true, email: this.config.user }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    } finally {
      try { await client.logout() } catch { /* ignore */ }
    }
  }

  async withSession<T>(fn: (session: EmailSession) => Promise<T>): Promise<T> {
    const client = new ImapFlow(this.buildOptions())
    await client.connect()
    const lock = await client.getMailboxLock('INBOX')
    try {
      const session: EmailSession = {
        search: async (opts: SearchOptions) => {
          const uids = await client.search({ gmailraw: opts.query }, { uid: true })
          if (uids === false) return []
          const list: MessageRef[] = uids.map((u: number) => ({ id: String(u) }))
          if (opts.maxResults != null && list.length > opts.maxResults) {
            return list.slice(-opts.maxResults)
          }
          return list
        },
        fetch: async (ref: MessageRef) => {
          const msg = await client.fetchOne(ref.id, { source: true }, { uid: true })
          if (!msg || !msg.source) return null

          const parsed = await simpleParser(msg.source)
          const attachments: Attachment[] = (parsed.attachments ?? []).map((a) => ({
            filename: a.filename ?? 'attachment',
            contentType: a.contentType ?? 'application/octet-stream',
            data: a.content,
          }))

          const text = parsed.text ?? ''
          const html = typeof parsed.html === 'string' ? parsed.html : ''
          return {
            id: ref.id,
            subject: parsed.subject ?? '',
            from: parsed.from?.text ?? '',
            date: parsed.date ?? new Date(),
            text,
            html,
            snippet: (text || html.replace(/<[^>]+>/g, ' ')).slice(0, 500),
            attachments,
          }
        },
      }
      return await fn(session)
    } finally {
      lock.release()
      try { await client.logout() } catch { /* ignore */ }
    }
  }

  async fetchOne(id: string): Promise<EmailMessage | null> {
    return this.withSession((s) => s.fetch({ id }))
  }
}
