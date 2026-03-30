import { Hono } from 'hono'
import { getConnectionStatus, searchEmails, getEmailWithAttachments } from '../services/gmail.js'
import { extractPdfText, getPdfBuffers } from '../services/pdf-parser.js'
import { extractBillFromText } from '../services/bill-extractor.js'
import { scanAndProcessEmails } from '../services/email-parser.js'
import { processNewBill } from '../services/notification.js'
import { sendTestMessage, isConfigured as telegramConfigured } from '../services/telegram.js'
import { isConfigured as calendarConfigured } from '../services/calendar.js'

const app = new Hono()

// Gmail connection status
app.get('/gmail/status', async (c) => {
  const status = await getConnectionStatus()
  return c.json(status)
})

// Manual email scan trigger
app.post('/gmail/scan', async (c) => {
  const result = await scanAndProcessEmails()

  // Send notifications for new bills
  for (const { bill, bank } of result.newBills) {
    await processNewBill(bill, bank)
  }

  return c.json({
    scanned: result.scanned,
    newBills: result.newBills.length,
    errors: result.errors,
  })
})

// Telegram test
app.post('/telegram/test', async (c) => {
  const success = await sendTestMessage()
  return c.json({ success })
})

// Integration status overview
app.get('/integrations/status', async (c) => {
  const gmail = await getConnectionStatus()
  return c.json({
    gmail,
    telegram: { configured: await telegramConfigured() },
    calendar: { configured: await calendarConfigured() },
  })
})

// Debug: search Gmail and preview emails
app.get('/gmail/search', async (c) => {
  const q = c.req.query('q') || 'newer_than:7d has:attachment'
  const max = Number(c.req.query('max')) || 10
  const ids = await searchEmails(q, max)
  return c.json({ query: q, count: ids.length, messageIds: ids })
})

// Debug: get email details + attachments info
app.get('/gmail/message/:id', async (c) => {
  const email = await getEmailWithAttachments(c.req.param('id'))
  if (!email) return c.json({ error: 'Email not found' }, 404)
  return c.json({
    id: email.id,
    subject: email.subject,
    from: email.from,
    date: email.date,
    bodyTextPreview: email.bodyText?.substring(0, 500),
    attachments: email.attachments.map((a) => ({
      filename: a.filename,
      mimeType: a.mimeType,
      size: a.data.length,
    })),
  })
})

// Debug: extract PDF text from an email attachment and try parsing
app.get('/gmail/message/:id/parse', async (c) => {
  const password = c.req.query('password') || undefined
  const bankCode = c.req.query('bank') || undefined
  const email = await getEmailWithAttachments(c.req.param('id'))
  if (!email) return c.json({ error: 'Email not found' }, 404)

  const pdfBuffers = await getPdfBuffers(email.attachments)
  if (pdfBuffers.length === 0) return c.json({ error: 'No PDF attachments found' })

  let pdfText: string | null = null
  let extractError: string | null = null
  for (const buf of pdfBuffers) {
    try {
      pdfText = await extractPdfText(buf, password)
      if (pdfText) break
    } catch (e) {
      extractError = (e as Error).message
    }
  }

  if (!pdfText) return c.json({ error: extractError || 'Failed to extract PDF text' })

  const parsed = extractBillFromText(pdfText, bankCode)

  return c.json({
    pdfTextPreview: pdfText.substring(0, 2000),
    pdfTextLength: pdfText.length,
    regexResult: parsed ? {
      amount: parsed.amount,
      minimumPayment: parsed.minimumPayment,
      dueDate: parsed.dueDate.toISOString().split('T')[0],
      billingPeriod: parsed.billingPeriod,
    } : null,
  })
})

export default app
