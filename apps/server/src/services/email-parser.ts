import fs from 'node:fs/promises'
import path from 'node:path'
import { PDF_DIR } from '@/paths.js'
import { logger } from '@/index.js'
import prisma from '@/prisma.js'
import { searchEmails, getEmailWithAttachments } from './gmail.js'
import { extractPdfText, getPdfBuffers } from './pdf-parser.js'
import { extractBillFromText } from './bill-extractor.js'
import { parseBillWithLLM } from './llm-parser.js'
import type { Bill, Bank } from '../../generated/prisma/client.js'
import { BillStatus } from '@bill-alarm/shared/types'


export interface ScanResult {
  scanned: number
  newBills: Array<{ bill: Bill; bank: Bank }>
  errors: string[]
}

export async function scanAndProcessEmails(): Promise<ScanResult> {
  const result: ScanResult = { scanned: 0, newBills: [], errors: [] }

  const banks = await prisma.bank.findMany({ where: { isActive: true } })
  if (banks.length === 0) return result

  const senderPatterns = banks.map((b) => `from:(${b.emailSenderPattern})`).join(' OR ')
  const query = `(${senderPatterns}) newer_than:60d has:attachment`

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

      const bank = banks.find((b) =>
        email.from.toLowerCase().includes(b.emailSenderPattern.toLowerCase()) &&
        email.subject.includes(b.emailSubjectPattern),
      )
      if (!bank) continue

      const pdfBuffers = await getPdfBuffers(email.attachments)
      if (pdfBuffers.length === 0) {
        logger.debug({ msgId, bank: bank.name }, 'No PDF attachments found')
        continue
      }

      let pdfText: string | null = null
      let matchedPdfBuf: Buffer | null = null
      let lastPdfError: string | null = null
      for (const pdfBuf of pdfBuffers) {
        try {
          pdfText = await extractPdfText(pdfBuf, bank.pdfPassword ?? undefined)
          if (pdfText) {
            matchedPdfBuf = pdfBuf
            break
          }
        } catch (e) {
          lastPdfError = (e as Error).message
          logger.warn({ bank: bank.name, error: lastPdfError }, 'PDF extraction failed')
        }
      }

      if (!pdfText) {
        const isPasswordError = lastPdfError?.includes('密碼')
        result.errors.push(
          isPasswordError
            ? `${bank.name}: PDF 密碼錯誤，請至銀行管理更新密碼`
            : `${bank.name}: PDF 文字擷取失敗${lastPdfError ? `（${lastPdfError}）` : ''}`,
        )
        continue
      }

      let parsed = extractBillFromText(pdfText, bank.code)
      if (!parsed) {
        logger.info({ bank: bank.name }, 'Regex failed, trying LLM fallback')
        try {
          parsed = await parseBillWithLLM(pdfText, bank.name)
        } catch (e) {
          logger.warn({ bank: bank.name, error: (e as Error).message }, 'LLM fallback failed')
        }
      }
      if (!parsed) {
        result.errors.push(`${bank.name}: 無法解析帳單內容（regex 和 LLM 都失敗）`)
        continue
      }

      const existing = await prisma.bill.findUnique({
        where: {
          bankId_billingPeriod: {
            bankId: bank.id,
            billingPeriod: parsed.billingPeriod,
          },
        },
      })
      if (existing) continue

      // Save PDF to filesystem
      let pdfPath: string | undefined
      if (matchedPdfBuf) {
        const filename = `${bank.code ?? bank.id}_${parsed.billingPeriod}.pdf`
        await fs.mkdir(PDF_DIR, { recursive: true })
        const filePath = path.join(PDF_DIR, filename)
        await fs.writeFile(filePath, matchedPdfBuf)
        pdfPath = `pdfs/${filename}`
        logger.info({ pdfPath }, 'PDF saved')
      }

      const bill = await prisma.bill.create({
        data: {
          bankId: bank.id,
          billingPeriod: parsed.billingPeriod,
          amount: parsed.amount,
          minimumPayment: parsed.minimumPayment,
          dueDate: parsed.dueDate,
          status: parsed.amount <= 0 ? BillStatus.PAID : BillStatus.PENDING,
          sourceEmailId: msgId,
          rawEmailSnippet: pdfText.substring(0, 500),
          pdfPath,
        },
      })

      logger.info({ bank: bank.name, amount: parsed.amount, dueDate: parsed.dueDate }, 'New bill created')
      result.newBills.push({ bill, bank })
    } catch (e) {
      result.errors.push(`Failed to process email ${msgId}: ${(e as Error).message}`)
    }
  }

  return result
}
