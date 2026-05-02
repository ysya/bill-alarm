import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { scanEvents, type ScanEvent } from '@/services/scan-events.js'
import { getConnectionStatus, searchEmails, getEmailWithAttachments } from '@/services/gmail.js'
import { extractPdfText, getPdfBuffers } from '@/services/pdf-parser.js'
import { extractBillFromText } from '@/services/bill-extractor.js'
import { parseBillWithLLM, suggestRuleWithLLM, testLlmConnection, getLlmProvider, LlmProvider } from '@/services/llm-parser.js'
import prisma from '@/prisma.js'
import { DATA_DIR } from '@/paths.js'
import fs from 'node:fs/promises'
import path from 'node:path'
import { decryptPdf } from '@/services/pdf-parser.js'
import { runScanWithLog, appendScanLogErrors, type ScanError } from '@/services/email-parser.js'
import { processNewBill } from '@/services/notification.js'
import { sendTestMessage, isConfigured as telegramConfigured } from '@/services/telegram.js'
import { isConfigured as calendarConfigured } from '@/services/calendar.js'
import { listParserCodes } from '@/parsers/registry.js'
import { parseWithTemplateDetailed } from '@/parsers/template.js'
import type { TemplateParserConfig } from '@bill-alarm/shared/template-parser'

const app = new Hono()

// Gmail connection status
app.get('/gmail/status', async (c) => {
  const status = await getConnectionStatus()
  return c.json(status)
})

// Manual email scan trigger
app.post('/gmail/scan', async (c) => {
  try {
    const { result, scanLogId } = await runScanWithLog('manual')

    // Send notifications for new bills
    const notifyErrors: ScanError[] = []
    for (const { bill, bank } of result.newBills) {
      try {
        await processNewBill(bill, bank)
      } catch (e) {
        notifyErrors.push({
          stage: 'notification',
          bank: bank.name,
          reason: `通知發送失敗：${(e as Error).message}`,
        })
      }
    }
    if (notifyErrors.length > 0) {
      await appendScanLogErrors(scanLogId, notifyErrors)
    }

    return c.json({
      scanLogId,
      scanned: result.scanned,
      newBills: result.newBills.length,
      errors: [...result.errors, ...notifyErrors],
    })
  } catch (e) {
    return c.json({
      error: (e as Error).message,
      scanned: 0,
      newBills: 0,
      errors: [{ stage: 'unexpected', reason: (e as Error).message }],
    }, 500)
  }
})

// Live scan progress via Server-Sent Events.
// Stays open and forwards events emitted from runScanWithLog().
app.get('/scan-events', (c) => {
  return streamSSE(c, async (stream) => {
    let resolveDone: () => void = () => {}
    const done = new Promise<void>((r) => { resolveDone = r })

    const listener = (event: ScanEvent) => {
      stream
        .writeSSE({ event: event.type, data: JSON.stringify(event) })
        .catch(() => { /* client disconnected mid-write */ })
    }
    scanEvents.on('scan', listener)

    stream.onAbort(() => {
      scanEvents.off('scan', listener)
      resolveDone()
    })

    // Initial hello so EventSource considers the stream open.
    await stream.writeSSE({ event: 'hello', data: '{}' })

    // If a scan is in progress right now, replay the latest known state
    // so a freshly-connected client (e.g. after page refresh) catches up
    // instead of waiting for the next event.
    const snapshot = scanEvents.getSnapshot()
    if (snapshot) {
      await stream.writeSSE({ event: 'start', data: JSON.stringify(snapshot.start) })
      if (snapshot.progress) {
        await stream.writeSSE({ event: 'progress', data: JSON.stringify(snapshot.progress) })
      }
    }

    // Heartbeat every 30s to keep proxies / Nuxt devProxy happy.
    const heartbeat = setInterval(() => {
      stream.writeSSE({ event: 'ping', data: '{}' }).catch(() => {})
    }, 30_000)

    try {
      await done
    } finally {
      clearInterval(heartbeat)
    }
  })
})

// Recent scan logs (most recent first)
app.get('/scan-logs', async (c) => {
  const limit = Math.min(Math.max(parseInt(c.req.query('limit') ?? '20'), 1), 100)
  const logs = await prisma.scanLog.findMany({
    orderBy: { startedAt: 'desc' },
    take: limit,
  })
  return c.json({
    logs: logs.map((l) => ({
      id: l.id,
      trigger: l.trigger,
      startedAt: l.startedAt.toISOString(),
      finishedAt: l.finishedAt?.toISOString() ?? null,
      scanned: l.scanned,
      newBillsCount: l.newBillsCount,
      errorCount: l.errorCount,
      errors: l.errors ? JSON.parse(l.errors) as ScanError[] : [],
      fatalError: l.fatalError,
    })),
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

// --- Parser debug / test routes (available in production) ---

// Search Gmail and preview emails
app.get('/gmail/search', async (c) => {
  const q = c.req.query('q') || 'newer_than:7d has:attachment'
  const max = Number(c.req.query('max')) || 10
  const ids = await searchEmails(q, max)
  return c.json({ query: q, count: ids.length, messageIds: ids })
})

// Get email details + attachments info
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

// Extract PDF text from an email attachment and try parsing
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

  const extracted = extractBillFromText(pdfText, bankCode)

  return c.json({
    pdfTextPreview: pdfText.substring(0, 3000),
    pdfTextFull: pdfText,
    pdfTextLength: pdfText.length,
    regexResult: extracted ? {
      amount: extracted.bill.amount,
      minimumPayment: extracted.bill.minimumPayment,
      dueDate: extracted.bill.dueDate.toISOString().split('T')[0],
      billingPeriod: extracted.bill.billingPeriod,
      source: extracted.source,
    } : null,
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

  const extracted = extractBillFromText(pdfText, bankCode ?? null)

  let llmResult = null
  if (useLlm && !extracted) {
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
    regexResult: extracted ? {
      amount: extracted.bill.amount,
      minimumPayment: extracted.bill.minimumPayment,
      dueDate: extracted.bill.dueDate.toISOString().split('T')[0],
      billingPeriod: extracted.bill.billingPeriod,
      source: extracted.source,
    } : null,
    llmResult,
  })
})

// Test parser with raw text input (no PDF needed)
app.post('/parser/test-text', async (c) => {
  const body = await c.req.json() as { text: string; bank?: string; llm?: boolean }
  if (!body.text) return c.json({ error: 'Missing text field' }, 400)

  const extracted = extractBillFromText(body.text, body.bank ?? null)

  let llmResult = null
  if (body.llm && !extracted) {
    try {
      llmResult = await parseBillWithLLM(body.text, body.bank ?? 'unknown')
    } catch (e) {
      llmResult = { error: (e as Error).message }
    }
  }

  return c.json({
    bankCode: body.bank ?? null,
    regexResult: extracted ? {
      amount: extracted.bill.amount,
      minimumPayment: extracted.bill.minimumPayment,
      dueDate: extracted.bill.dueDate.toISOString().split('T')[0],
      billingPeriod: extracted.bill.billingPeriod,
      source: extracted.source,
    } : null,
    llmResult,
  })
})

// Test a template config inline (not stored) against provided text
const fieldRuleSchema = z.object({
  keyword: z.string().min(1),
  type: z.enum(['amount', 'rocDate', 'adDate', 'yearMonth']),
  nth: z.number().int().positive().optional(),
})
app.post('/parser/test-template', zValidator('json', z.object({
  text: z.string().min(1),
  config: z.object({
    amount: fieldRuleSchema,
    dueDate: fieldRuleSchema,
    minimumPayment: fieldRuleSchema.optional(),
    billingPeriod: fieldRuleSchema.optional(),
  }),
})), async (c) => {
  const { text, config } = c.req.valid('json')
  const detail = parseWithTemplateDetailed(text, config as TemplateParserConfig)

  return c.json({
    success: !!detail.bill,
    result: detail.bill ? {
      amount: detail.bill.amount,
      minimumPayment: detail.bill.minimumPayment,
      dueDate: detail.bill.dueDate.toISOString().split('T')[0],
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
    fallback: 'generic',
  })
})

// --- LLM routes ---

// Current LLM provider status
app.get('/llm/status', async (c) => {
  const provider = await getLlmProvider()
  return c.json({ provider })
})

// Test LLM connection (provider + config must already be saved)
app.post('/llm/test', async (c) => {
  const provider = await getLlmProvider()
  if (provider === LlmProvider.None) return c.json({ ok: false, message: 'LLM 提供者未設定' })
  const result = await testLlmConnection(provider)
  return c.json(result)
})

// Ask LLM to suggest a rule from a selection
app.post('/llm/suggest-rule', zValidator('json', z.object({
  text: z.string().min(1),
  value: z.string().min(1),
  startIndex: z.number().int().min(0),
  fieldLabel: z.string().min(1),
})), async (c) => {
  const { text, value, startIndex, fieldLabel } = c.req.valid('json')
  try {
    const rule = await suggestRuleWithLLM(text, value, startIndex, fieldLabel)
    if (!rule) return c.json({ error: 'LLM 回傳格式無法解析' }, 422)
    return c.json({ rule })
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500)
  }
})

// Bootstrap parser editor from an existing bill:
// - Loads bill + bank
// - Re-extracts PDF text from the saved PDF
// - Returns text + bank info so frontend can auto-fill the editor
app.get('/parser/bootstrap/:billId', async (c) => {
  const bill = await prisma.bill.findUnique({
    where: { id: c.req.param('billId') },
    include: { bank: true },
  })
  if (!bill) return c.json({ error: 'Bill not found' }, 404)
  if (!bill.pdfPath) return c.json({ error: 'Bill has no saved PDF' }, 400)

  let pdfText: string | null = null
  try {
    const filePath = path.join(DATA_DIR, bill.pdfPath)
    const buffer = await fs.readFile(filePath)
    const decrypted = await decryptPdf(buffer, bill.bank.pdfPassword ?? undefined)
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
      dueDate: bill.dueDate.toISOString().split('T')[0],
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
