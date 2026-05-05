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

export interface SearchOptions {
  query: string
  sinceDays: number
  maxResults?: number
}

export interface VerifyResult {
  ok: boolean
  email?: string
  error?: string
}

export interface EmailSession {
  search(opts: SearchOptions): Promise<MessageRef[]>
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
