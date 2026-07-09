import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { getEmailProviderFor } from '@/services/email/index.js'
import { extractPdfText, getPdfBuffers, decryptPdf } from '@/services/pdf-parser.js'
import { parseBill } from '@/services/bill-parser.js'
import { getBankPdfPassword } from '@/services/secrets.js'
import prisma from '@/prisma.js'
import { DATA_DIR } from '@/paths.js'
import fs from 'node:fs/promises'
import path from 'node:path'
import { getAuthUser } from './auth.js'
import { listParserCodes } from '@/parsers/registry.js'
import { parseWithTemplateDetailed } from '@/parsers/template.js'
import { templateParserConfigSchema } from '@bill-alarm/shared/template-parser'

const app = new Hono()

async function currentUser(c: Parameters<typeof getAuthUser>[0]) {
  return prisma.user.findUnique({ where: { id: getAuthUser(c).id } })
}

// Search inbox and preview emails — Gmail-only debug tool. Uses the raw Gmail
// search syntax (searchRaw), since it needs free-form query strings that the
// structured SearchCriteria used by the real scan pipeline can't express.
// Non-Gmail providers/hosts don't implement searchRaw; see gmail-imap.ts.
app.get('/email/search', async (c) => {
  const q = c.req.query('q') || 'newer_than:7d has:attachment'
  const max = Number(c.req.query('max')) || 10
  const me = await currentUser(c)
  const provider = me ? getEmailProviderFor(me) : null
  if (!provider) return c.json({ error: 'Email provider not configured' }, 400)

  const refs = await provider.withSession((session) => (
    session.searchRaw ? session.searchRaw(q) : Promise.resolve(null)
  ))
  if (refs === null) {
    return c.json({ error: 'This mailbox provider does not support raw debug search (Gmail-only tool)' }, 400)
  }
  const trimmed = refs.length > max ? refs.slice(-max) : refs
  return c.json({
    query: q,
    count: trimmed.length,
    messageIds: trimmed.map((r) => r.id),
    note: 'Gmail-only debug query',
  })
})

// Get email details + attachments info
app.get('/email/message/:id', async (c) => {
  const me = await currentUser(c)
  const provider = me ? getEmailProviderFor(me) : null
  if (!provider) return c.json({ error: 'Email provider not configured' }, 400)
  const email = await provider.fetchOne(c.req.param('id'))
  if (!email) return c.json({ error: 'Email not found' }, 404)
  return c.json({
    id: email.id,
    subject: email.subject,
    from: email.from,
    date: email.date,
    bodyTextPreview: email.text.substring(0, 500),
    attachments: email.attachments.map((a) => ({
      filename: a.filename,
      contentType: a.contentType,
      size: a.data.length,
    })),
  })
})

// Extract PDF text from an email attachment and try parsing
app.get('/email/message/:id/parse', async (c) => {
  const password = c.req.query('password') || undefined
  const bankCode = c.req.query('bank') || undefined
  const me = await currentUser(c)
  const provider = me ? getEmailProviderFor(me) : null
  if (!provider) return c.json({ error: 'Email provider not configured' }, 400)
  const email = await provider.fetchOne(c.req.param('id'))
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

  const bank = { code: bankCode ?? null, name: bankCode ?? 'unknown', parserConfig: null as string | null }
  const outcome = await parseBill(pdfText, bank, { allowLlm: false })
  const regexBill = outcome.bill && (outcome.source === 'template' || outcome.source === 'hardcoded') ? outcome.bill : null

  return c.json({
    pdfTextPreview: pdfText.substring(0, 3000),
    pdfTextFull: pdfText,
    pdfTextLength: pdfText.length,
    regexResult: regexBill ? {
      amount: regexBill.amount,
      minimumPayment: regexBill.minimumPayment,
      dueDate: regexBill.dueDate,
      billingPeriod: regexBill.billingPeriod,
      source: outcome.source,
    } : null,
    attempts: outcome.attempts,
  })
})

// Upload PDF and test parser
app.post('/parser/test-pdf', async (c) => {
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

  const bank = { code: bankCode ?? null, name: bankCode ?? 'unknown', parserConfig: null as string | null }
  const outcome = await parseBill(pdfText, bank, { allowLlm: useLlm })
  const regexBill = outcome.bill && (outcome.source === 'template' || outcome.source === 'hardcoded') ? outcome.bill : null

  return c.json({
    pdfText: pdfText.substring(0, 3000),
    pdfTextLength: pdfText.length,
    bankCode: bankCode ?? null,
    regexResult: regexBill ? {
      amount: regexBill.amount,
      minimumPayment: regexBill.minimumPayment,
      dueDate: regexBill.dueDate,
      billingPeriod: regexBill.billingPeriod,
      source: outcome.source,
    } : null,
    llmResult: outcome.source === 'llm' ? outcome.bill : null,
    attempts: outcome.attempts,
  })
})

// Test parser with raw text input (no PDF needed)
app.post('/parser/test-text', async (c) => {
  const body = await c.req.json() as { text: string; bank?: string; llm?: boolean }
  if (!body.text) return c.json({ error: 'Missing text field' }, 400)

  const bank = { code: body.bank ?? null, name: body.bank ?? 'unknown', parserConfig: null as string | null }
  const outcome = await parseBill(body.text, bank, { allowLlm: !!body.llm })
  const regexBill = outcome.bill && (outcome.source === 'template' || outcome.source === 'hardcoded') ? outcome.bill : null

  return c.json({
    bankCode: body.bank ?? null,
    regexResult: regexBill ? {
      amount: regexBill.amount,
      minimumPayment: regexBill.minimumPayment,
      dueDate: regexBill.dueDate,
      billingPeriod: regexBill.billingPeriod,
      source: outcome.source,
    } : null,
    llmResult: outcome.source === 'llm' ? outcome.bill : null,
    attempts: outcome.attempts,
  })
})

// Test a template config inline (not stored) against provided text
app.post('/parser/test-template', zValidator('json', z.object({
  text: z.string().min(1),
  config: templateParserConfigSchema,
})), async (c) => {
  const { text, config } = c.req.valid('json')
  const detail = parseWithTemplateDetailed(text, config)

  return c.json({
    success: !!detail.bill,
    result: detail.bill ? {
      amount: detail.bill.amount,
      minimumPayment: detail.bill.minimumPayment,
      dueDate: detail.bill.dueDate,
      billingPeriod: detail.bill.billingPeriod,
    } : null,
    matches: detail.matches,
    errors: detail.errors,
  })
})

// List registered parsers
app.get('/parser/list', (c) => {
  return c.json({
    parsers: listParserCodes().map((code) => ({ code, bankCode: code })),
    fallback: 'llm',
  })
})

// Bootstrap parser editor from an existing bill:
// - Loads bill + bank
// - Re-extracts PDF text from the saved PDF
// - Returns text + bank info so frontend can auto-fill the editor
app.get('/parser/bootstrap/:billId', async (c) => {
  const bill = await prisma.bill.findFirst({
    where: { id: c.req.param('billId'), bank: { userId: getAuthUser(c).id } },
    include: { bank: true },
  })
  if (!bill) return c.json({ error: 'Bill not found' }, 404)
  if (!bill.pdfPath) return c.json({ error: 'Bill has no saved PDF' }, 400)

  let pdfText: string | null = null
  try {
    const filePath = path.join(DATA_DIR, bill.pdfPath)
    const buffer = await fs.readFile(filePath)
    const decrypted = await decryptPdf(buffer, getBankPdfPassword(bill.bank))
    // Re-extract text using mupdf
    const mupdf = await import('mupdf')
    const doc = mupdf.Document.openDocument(decrypted, 'application/pdf')
    const pages: string[] = []
    for (let i = 0; i < doc.countPages(); i++) {
      const page = doc.loadPage(i)
      pages.push(page.toStructuredText('preserve-whitespace').asText())
    }
    pdfText = pages.join('\n')
  } catch (e) {
    return c.json({ error: `Failed to read PDF: ${(e as Error).message}` }, 500)
  }

  return c.json({
    pdfText,
    bill: {
      id: bill.id,
      amount: bill.amount,
      minimumPayment: bill.minimumPayment,
      dueDate: bill.dueDate,
      billingPeriod: bill.billingPeriod,
      parseSource: bill.parseSource,
    },
    bank: {
      id: bill.bank.id,
      code: bill.bank.code,
      name: bill.bank.name,
      parserConfig: bill.bank.parserConfig,
    },
  })
})

export default app
