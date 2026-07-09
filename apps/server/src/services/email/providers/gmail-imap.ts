import { ImapFlow, type ImapFlowOptions, type SearchObject } from 'imapflow'
import { simpleParser } from 'mailparser'
import { logger } from '@/index.js'
import { getSetting, KEYS } from '@/services/settings.js'
import type {
  EmailProvider,
  EmailMessage,
  EmailSession,
  MessageRef,
  SearchCriteria,
  VerifyResult,
  Attachment,
} from '../types.js'

export interface GmailImapConfig {
  host: string
  port: number
  user: string
  password: string
}

/** Gmail's IMAP servers accept the non-standard `gmailraw` (X-GM-RAW) search
 *  extension; every other host must get a standard IMAP SearchObject instead. */
function isGmailHost(host: string): boolean {
  const h = host.toLowerCase()
  return h === 'imap.gmail.com' || h.endsWith('.gmail.com')
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

  /** Gmail fast path: builds the `gmailraw` (X-GM-RAW) query string — same semantics
   *  as before this refactor (OR'd senders, newer_than range, optional has:attachment,
   *  plus the Gmail-only SCAN_GMAIL_QUERY_EXTRA setting appended at the end). */
  private async buildGmailSearch(criteria: SearchCriteria): Promise<SearchObject> {
    const senderPatterns = criteria.senders.map((s) => `from:(${s})`).join(' OR ')
    const attachmentClause = criteria.hasAttachment ? ' has:attachment' : ''
    const extraQuery = (await getSetting(KEYS.SCAN_GMAIL_QUERY_EXTRA)) || ''
    const query = `(${senderPatterns}) newer_than:${criteria.sinceDays}d${attachmentClause}${extraQuery ? ` ${extraQuery.trim()}` : ''}`
    return { gmailraw: query }
  }

  /** Standard IMAP path (non-Gmail hosts): structured SearchObject. IMAP has no
   *  HASATTACHMENT criterion, so `hasAttachment` is ignored here — the scan pipeline
   *  already post-filters by PDF attachment presence. SCAN_GMAIL_QUERY_EXTRA is
   *  Gmail-only syntax and is skipped (logged once so it's visible why). */
  private buildImapSearch(criteria: SearchCriteria): SearchObject {
    const since = new Date(Date.now() - criteria.sinceDays * 24 * 60 * 60 * 1000)
    const fromClauses = criteria.senders.map((sender) => ({ from: sender }))
    logger.info(
      { host: this.config.host },
      'Non-Gmail IMAP host: SCAN_GMAIL_QUERY_EXTRA (Gmail-only) and hasAttachment (no standard IMAP criterion) are skipped',
    )
    if (fromClauses.length === 0) return { since }
    if (fromClauses.length === 1) return { since, ...fromClauses[0] }
    // imapflow's `or` takes an n-ary array (2+ SearchObjects, per its own type
    // comment) and compiles it into the required binary IMAP OR tree internally —
    // confirmed by reading node_modules/imapflow/lib/search-compiler.js.
    return { since, or: fromClauses }
  }

  async withSession<T>(fn: (session: EmailSession) => Promise<T>): Promise<T> {
    const client = new ImapFlow(this.buildOptions())
    await client.connect()
    const lock = await client.getMailboxLock('INBOX')
    const gmail = isGmailHost(this.config.host)
    try {
      const toRefs = (uids: number[] | false): MessageRef[] =>
        uids === false ? [] : uids.map((u) => ({ id: String(u) }))

      const session: EmailSession = {
        search: async (criteria: SearchCriteria) => {
          const query = gmail ? await this.buildGmailSearch(criteria) : this.buildImapSearch(criteria)
          const uids = await client.search(query, { uid: true })
          return toRefs(uids)
        },
        // Gmail-only debug escape hatch — only meaningful (and only supported by
        // the server) when actually talking to Gmail's IMAP extension.
        ...(gmail ? {
          searchRaw: async (q: string) => {
            const uids = await client.search({ gmailraw: q }, { uid: true })
            return toRefs(uids)
          },
        } : {}),
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
