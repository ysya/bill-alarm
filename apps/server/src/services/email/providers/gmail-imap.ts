import { ImapFlow, type ImapFlowOptions } from 'imapflow'
import { simpleParser } from 'mailparser'
import type {
  EmailProvider,
  EmailMessage,
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

  private async withClient<T>(fn: (client: ImapFlow) => Promise<T>): Promise<T> {
    const client = new ImapFlow(this.buildOptions())
    await client.connect()
    try {
      return await fn(client)
    } finally {
      try { await client.logout() } catch { /* ignore close errors */ }
    }
  }

  async verify(): Promise<VerifyResult> {
    try {
      await this.withClient(async () => { /* connect succeeded */ })
      return { ok: true, email: this.config.user }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  }

  async search(opts: SearchOptions): Promise<MessageRef[]> {
    return this.withClient(async (client) => {
      const lock = await client.getMailboxLock('INBOX')
      try {
        const uids = await client.search({ gmailraw: opts.query }, { uid: true })
        if (uids === false) return []
        const list = uids.map((u: number) => ({ id: String(u) }))
        if (opts.maxResults != null && list.length > opts.maxResults) {
          return list.slice(-opts.maxResults)
        }
        return list
      } finally {
        lock.release()
      }
    })
  }

  async fetch(ref: MessageRef): Promise<EmailMessage | null> {
    return this.withClient(async (client) => {
      const lock = await client.getMailboxLock('INBOX')
      try {
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
      } finally {
        lock.release()
      }
    })
  }
}
