import { logger } from '../index.js'
import prisma from '../db/prisma.js'
import { searchEmails, getEmailWithAttachments } from './gmail.js'
import { extractPdfText, getPdfBuffers } from './pdf-parser.js'
import { extractBillFromText } from './bill-extractor.js'
import { parseBillWithLLM } from './llm-parser.js'
import type { Bill, CreditCard } from '../../generated/prisma/client.js'

export interface ScanResult {
  scanned: number
  newBills: Array<{ bill: Bill; card: CreditCard }>
  errors: string[]
}

export async function scanAndProcessEmails(): Promise<ScanResult> {
  const result: ScanResult = { scanned: 0, newBills: [], errors: [] }

  const cards = await prisma.creditCard.findMany({ where: { isActive: true } })
  if (cards.length === 0) return result

  // Build Gmail query from all card sender patterns
  const senderPatterns = cards.map((c) => `from:(${c.emailSenderPattern})`).join(' OR ')
  const query = `(${senderPatterns}) newer_than:7d has:attachment`

  let messageIds: string[]
  try {
    messageIds = await searchEmails(query)
  } catch (e) {
    result.errors.push(`Gmail search failed: ${(e as Error).message}`)
    return result
  }

  result.scanned = messageIds.length
  logger.info({ count: messageIds.length }, 'Found emails to process')

  for (const msgId of messageIds) {
    try {
      const email = await getEmailWithAttachments(msgId)
      if (!email) continue

      // Match email to a bank card via sender + subject patterns
      const card = cards.find((c) =>
        email.from.toLowerCase().includes(c.emailSenderPattern.toLowerCase()) &&
        email.subject.includes(c.emailSubjectPattern),
      )
      if (!card) continue

      // Get PDF buffers from attachments (handles ZIP too)
      const pdfBuffers = await getPdfBuffers(email.attachments)
      if (pdfBuffers.length === 0) {
        logger.debug({ msgId, bank: card.bankName }, 'No PDF attachments found')
        continue
      }

      // Try to extract text from the first PDF
      let pdfText: string | null = null
      for (const pdfBuf of pdfBuffers) {
        try {
          pdfText = await extractPdfText(pdfBuf, card.pdfPassword ?? undefined)
          if (pdfText) break
        } catch (e) {
          logger.warn({ bank: card.bankName, error: (e as Error).message }, 'PDF extraction failed')
        }
      }

      if (!pdfText) {
        result.errors.push(`${card.bankName}: PDF 文字擷取失敗`)
        continue
      }

      // Try regex first, fallback to LLM
      let parsed = extractBillFromText(pdfText)
      if (!parsed) {
        logger.info({ bank: card.bankName }, 'Regex failed, trying LLM fallback')
        try {
          parsed = await parseBillWithLLM(pdfText, card.bankName)
        } catch (e) {
          logger.warn({ bank: card.bankName, error: (e as Error).message }, 'LLM fallback failed')
        }
      }
      if (!parsed) {
        result.errors.push(`${card.bankName}: 無法解析帳單內容（regex 和 LLM 都失敗）`)
        continue
      }

      // Check for duplicate
      const existing = await prisma.bill.findUnique({
        where: {
          creditCardId_billingPeriod: {
            creditCardId: card.id,
            billingPeriod: parsed.billingPeriod,
          },
        },
      })
      if (existing) continue

      // Create new bill
      const bill = await prisma.bill.create({
        data: {
          creditCardId: card.id,
          billingPeriod: parsed.billingPeriod,
          amount: parsed.amount,
          minimumPayment: parsed.minimumPayment,
          dueDate: parsed.dueDate,
          sourceEmailId: msgId,
          rawEmailSnippet: pdfText.substring(0, 500),
        },
      })

      logger.info({ bank: card.bankName, amount: parsed.amount, dueDate: parsed.dueDate }, 'New bill created')
      result.newBills.push({ bill, card })
    } catch (e) {
      result.errors.push(`Failed to process email ${msgId}: ${(e as Error).message}`)
    }
  }

  return result
}
