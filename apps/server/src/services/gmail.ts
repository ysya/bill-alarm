import { google } from 'googleapis'
import { getSetting, setSetting, KEYS } from './settings.js'

export interface EmailAttachment {
  filename: string
  mimeType: string
  data: Buffer
}

export interface GmailEmail {
  id: string
  subject: string
  from: string
  date: Date
  bodyText?: string
  bodyHtml?: string
  attachments: EmailAttachment[]
}

async function getAuth() {
  const clientId = await getSetting(KEYS.GOOGLE_CLIENT_ID)
  const clientSecret = await getSetting(KEYS.GOOGLE_CLIENT_SECRET)
  const refreshToken = await getSetting(KEYS.GOOGLE_REFRESH_TOKEN)

  if (!clientId || !clientSecret || !refreshToken) return null

  const auth = new google.auth.OAuth2(clientId, clientSecret)
  auth.setCredentials({ refresh_token: refreshToken })

  // Auto-save if Google issues a new refresh token
  auth.on('tokens', async (tokens) => {
    if (tokens.refresh_token) {
      await setSetting(KEYS.GOOGLE_REFRESH_TOKEN, tokens.refresh_token)
    }
  })

  return auth
}

export async function getConnectionStatus(): Promise<{ connected: boolean; message: string }> {
  const auth = await getAuth()
  if (!auth) return { connected: false, message: 'Gmail OAuth credentials not configured' }
  try {
    const gmail = google.gmail({ version: 'v1', auth })
    const profile = await gmail.users.getProfile({ userId: 'me' })
    return { connected: true, message: `Connected as ${profile.data.emailAddress}` }
  } catch (e) {
    return { connected: false, message: `Connection failed: ${(e as Error).message}` }
  }
}

export async function searchEmails(query: string, maxResults = 20): Promise<string[]> {
  const auth = await getAuth()
  if (!auth) return []
  const gmail = google.gmail({ version: 'v1', auth })
  const res = await gmail.users.messages.list({ userId: 'me', q: query, maxResults })
  return res.data.messages?.map((m) => m.id!) ?? []
}

export async function getEmailWithAttachments(messageId: string): Promise<GmailEmail | null> {
  const auth = await getAuth()
  if (!auth) return null
  const gmail = google.gmail({ version: 'v1', auth })
  const res = await gmail.users.messages.get({ userId: 'me', id: messageId, format: 'full' })

  const headers = res.data.payload?.headers ?? []
  const subject = headers.find((h) => h.name === 'Subject')?.value ?? ''
  const from = headers.find((h) => h.name === 'From')?.value ?? ''
  const dateStr = headers.find((h) => h.name === 'Date')?.value ?? ''

  let bodyHtml = ''
  let bodyText = ''
  const attachments: EmailAttachment[] = []

  async function processParts(parts: typeof res.data.payload.parts) {
    if (!parts) return
    for (const part of parts) {
      // Nested multipart
      if (part.parts) {
        await processParts(part.parts)
        continue
      }

      // Body text
      if (part.mimeType === 'text/html' && part.body?.data) {
        bodyHtml = Buffer.from(part.body.data, 'base64url').toString('utf-8')
      }
      if (part.mimeType === 'text/plain' && part.body?.data) {
        bodyText = Buffer.from(part.body.data, 'base64url').toString('utf-8')
      }

      // Attachments (PDF, ZIP)
      if (part.filename && part.body?.attachmentId) {
        const isPdf = part.mimeType === 'application/pdf' || part.filename.endsWith('.pdf')
        const isZip = part.mimeType === 'application/zip' || part.filename.endsWith('.zip')

        if (isPdf || isZip) {
          const attRes = await gmail.users.messages.attachments.get({
            userId: 'me',
            messageId,
            id: part.body.attachmentId,
          })
          if (attRes.data.data) {
            attachments.push({
              filename: part.filename,
              mimeType: part.mimeType ?? 'application/octet-stream',
              data: Buffer.from(attRes.data.data, 'base64url'),
            })
          }
        }
      }
    }
  }

  // Handle single-part emails
  if (res.data.payload?.body?.data) {
    const mime = res.data.payload.mimeType
    const decoded = Buffer.from(res.data.payload.body.data, 'base64url').toString('utf-8')
    if (mime === 'text/html') bodyHtml = decoded
    if (mime === 'text/plain') bodyText = decoded
  }

  // Handle multipart emails
  await processParts(res.data.payload?.parts)

  return {
    id: messageId,
    subject,
    from,
    date: new Date(dateStr),
    bodyText: bodyText || undefined,
    bodyHtml: bodyHtml || undefined,
    attachments,
  }
}
