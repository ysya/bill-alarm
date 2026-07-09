export interface MessageRef {
  id: string
}

export interface Attachment {
  filename: string
  contentType: string
  data: Buffer
}

export interface EmailMessage {
  id: string
  subject: string
  from: string
  date: Date
  text: string
  html: string
  snippet: string
  attachments: Attachment[]
}

export interface SearchCriteria {
  /** OR-matched FROM patterns (bank sender addresses). */
  senders: string[]
  sinceDays: number
  /** Gmail fast-path filter only; standard IMAP has no such criterion and ignores
   *  this — the scan pipeline already post-filters by PDF attachment presence. */
  hasAttachment: boolean
}

export interface VerifyResult {
  ok: boolean
  email?: string
  error?: string
}

export interface EmailSession {
  search(criteria: SearchCriteria): Promise<MessageRef[]>
  /** Gmail-only debug escape hatch (raw `gmailraw`/X-GM-RAW query). Undefined on
   *  non-Gmail providers/hosts — callers must feature-detect before use. */
  searchRaw?(query: string): Promise<MessageRef[]>
  fetch(ref: MessageRef): Promise<EmailMessage | null>
}

export interface EmailProvider {
  readonly name: string
  verify(): Promise<VerifyResult>
  /** Opens a session, runs `fn` while the underlying connection stays open, then tears down. */
  withSession<T>(fn: (session: EmailSession) => Promise<T>): Promise<T>
  /** Convenience for one-off lookups (e.g. debug routes). Opens its own session. */
  fetchOne(id: string): Promise<EmailMessage | null>
}

export type EmailProviderName = 'gmail-imap'
