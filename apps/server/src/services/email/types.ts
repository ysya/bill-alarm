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

export interface EmailProvider {
  readonly name: string
  verify(): Promise<VerifyResult>
  search(opts: SearchOptions): Promise<MessageRef[]>
  fetch(ref: MessageRef): Promise<EmailMessage | null>
}

export type EmailProviderName = 'gmail-imap'
