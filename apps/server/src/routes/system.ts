import { Hono } from 'hono'
import { getConnectionStatus, searchEmails, getEmailWithAttachments } from '@/services/gmail.js'
import { extractPdfText, getPdfBuffers } from '@/services/pdf-parser.js'
import { extractBillFromText } from '@/services/bill-extractor.js'
import { parseBillWithLLM } from '@/services/llm-parser.js'
import { scanAndProcessEmails } from '@/services/email-parser.js'
import { processNewBill } from '@/services/notification.js'
import { sendTestMessage, isConfigured as telegramConfigured } from '@/services/telegram.js'
import { isConfigured as calendarConfigured } from '@/services/calendar.js'
import { getParser } from '@/parsers/registry.js'

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

// --- Dev/Debug routes (development only) ---
if (process.env.NODE_ENV !== 'production') {

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

// Dev: upload PDF and test parser without any external services
app.post('/dev/parse-pdf', async (c) => {
  const formData = await c.req.formData()
  const file = formData.get('file') as File | null
  const bankCode = (formData.get('bank') as string) || undefined
  const password = (formData.get('password') as string) || undefined
  const useLlm = formData.get('llm') === 'true'

  if (!file) return c.json({ error: 'Missing file field' }, 400)

  const buffer = Buffer.from(await file.arrayBuffer())

  let pdfText: string | null = null
  try {
    pdfText = await extractPdfText(buffer, password)
  } catch (e) {
    return c.json({ error: (e as Error).message, step: 'extract_text' }, 400)
  }

  if (!pdfText) return c.json({ error: 'PDF text extraction returned empty', step: 'extract_text' }, 400)

  // Try regex parser
  const regexResult = extractBillFromText(pdfText, bankCode ?? null)

  // Try LLM parser if requested
  let llmResult = null
  if (useLlm && !regexResult) {
    try {
      llmResult = await parseBillWithLLM(pdfText, bankCode ?? 'unknown')
    } catch (e) {
      llmResult = { error: (e as Error).message }
    }
  }

  return c.json({
    pdfText: pdfText.substring(0, 3000),
    pdfTextLength: pdfText.length,
    bankCode: bankCode ?? null,
    parserUsed: bankCode ? getParser(bankCode).bankCode : 'generic',
    regexResult: regexResult ? {
      amount: regexResult.amount,
      minimumPayment: regexResult.minimumPayment,
      dueDate: regexResult.dueDate.toISOString().split('T')[0],
      billingPeriod: regexResult.billingPeriod,
    } : null,
    llmResult,
  })
})

// Dev: test parser with raw text input (no PDF needed)
app.post('/dev/parse-text', async (c) => {
  const body = await c.req.json() as { text: string; bank?: string; llm?: boolean }
  if (!body.text) return c.json({ error: 'Missing text field' }, 400)

  const regexResult = extractBillFromText(body.text, body.bank ?? null)

  let llmResult = null
  if (body.llm && !regexResult) {
    try {
      llmResult = await parseBillWithLLM(body.text, body.bank ?? 'unknown')
    } catch (e) {
      llmResult = { error: (e as Error).message }
    }
  }

  return c.json({
    bankCode: body.bank ?? null,
    parserUsed: body.bank ? getParser(body.bank).bankCode : 'generic',
    regexResult: regexResult ? {
      amount: regexResult.amount,
      minimumPayment: regexResult.minimumPayment,
      dueDate: regexResult.dueDate.toISOString().split('T')[0],
      billingPeriod: regexResult.billingPeriod,
    } : null,
    llmResult,
  })
})

// Dev: list available parsers
app.get('/dev/parsers', (c) => {
  const parsers = ['esun', 'yuanta', 'ctbc', 'taishin', 'sinopac', 'ubot', 'cathay']
  return c.json({
    parsers: parsers.map((code) => ({
      code,
      bankCode: getParser(code).bankCode,
    })),
    fallback: 'generic',
  })
})

} // end dev-only routes

export default app
