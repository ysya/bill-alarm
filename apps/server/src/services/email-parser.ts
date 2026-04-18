import fs from 'node:fs/promises'
import path from 'node:path'
import { PDF_DIR } from '@/paths.js'
import { logger } from '@/index.js'
import prisma from '@/prisma.js'
import { searchEmails, getEmailWithAttachments } from './gmail.js'
import { extractPdfText, getPdfBuffers } from './pdf-parser.js'
import { extractBillFromText } from './bill-extractor.js'
import { parseBillWithLLM, getLlmProvider } from './llm-parser.js'
import { getSetting, KEYS } from './settings.js'
import type { Bill, Bank } from '../../generated/prisma/client.js'
import { BillStatus, type ParsedBill } from '@bill-alarm/shared/types'


export interface ScanResult {
  scanned: number
  newBills: Array<{ bill: Bill; bank: Bank }>
  errors: string[]
}

/**
 * Sanity check parsed bill values to catch LLM hallucinations
 * or obviously wrong extraction. Returns error string, or null if OK.
 */
function sanityCheck(parsed: ParsedBill): string | null {
  if (!Number.isFinite(parsed.amount)) return '金額非數字'
  if (Math.abs(parsed.amount) > 500_000) return `金額超出合理範圍 (${parsed.amount})`
  if (parsed.minimumPayment != null && parsed.minimumPayment > Math.abs(parsed.amount)) {
    return '最低應繳超過本期應繳總額'
  }
  const now = Date.now()
  const diff = parsed.dueDate.getTime() - now
  const days = diff / (1000 * 60 * 60 * 24)
  if (days < -90) return '繳款截止日在過去 90 天以前'
  if (days > 90) return '繳款截止日超過未來 90 天'
  return null
}

export async function scanAndProcessEmails(): Promise<ScanResult> {
  const result: ScanResult = { scanned: 0, newBills: [], errors: [] }

  const banks = await prisma.bank.findMany({ where: { isActive: true } })
  if (banks.length === 0) return result

  const senderPatterns = banks.map((b) => `from:(${b.emailSenderPattern})`).join(' OR ')
  const rangeDaysRaw = await getSetting(KEYS.SCAN_RANGE_DAYS)
  const rangeDays = rangeDaysRaw ? Math.max(1, parseInt(rangeDaysRaw)) : 60
  const extraQuery = (await getSetting(KEYS.SCAN_GMAIL_QUERY_EXTRA)) || ''
  const query = `(${senderPatterns}) newer_than:${rangeDays}d has:attachment${extraQuery ? ` ${extraQuery.trim()}` : ''}`

  logger.info({ query, rangeDays }, 'Gmail scan query')

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

      let parsed: ParsedBill | null = null
      let source: 'template' | 'hardcoded' | 'generic' | 'llm' | null = null

      // 1. Template (if user explicitly configured)
      if (bank.parserConfig) {
        const r = extractBillFromText(pdfText, bank.code, bank.parserConfig)
        if (r?.source === 'template') {
          parsed = r.bill
          source = 'template'
        }
      }

      // 2. LLM as primary (LLM-first for user to just-review-and-edit)
      if (!parsed) {
        const llmProvider = await getLlmProvider()
        if (llmProvider !== 'none') {
          try {
            parsed = await parseBillWithLLM(pdfText, bank.name)
            if (parsed) source = 'llm'
          } catch (e) {
            logger.warn({ bank: bank.name, error: (e as Error).message }, 'LLM parse failed, falling back to regex')
          }
        }
      }

      // 3. Hardcoded / generic fallback (offline safety net)
      if (!parsed) {
        const r = extractBillFromText(pdfText, bank.code)
        if (r) {
          parsed = r.bill
          source = r.source
        }
      }

      if (!parsed) {
        result.errors.push(`${bank.name}: 無法解析帳單內容（template/LLM/regex 全部失敗）`)
        continue
      }

      // Sanity check — catch obvious LLM hallucinations
      const sanityErr = sanityCheck(parsed)
      if (sanityErr) {
        logger.warn({ bank: bank.name, source, parsed, error: sanityErr }, 'Parsed bill failed sanity check')
        result.errors.push(`${bank.name}: 解析結果異常（${sanityErr}），請手動確認`)
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
          parseSource: source,
          sourceEmailId: msgId,
          rawEmailSnippet: pdfText.substring(0, 500),
          pdfPath,
        },
      })

      logger.info({ bank: bank.name, amount: parsed.amount, dueDate: parsed.dueDate }, 'New bill created')
      result.newBills.push({ bill, bank })
    } catch (e) {
      const msg = (e as Error).message ?? String(e)
      logger.error({ msgId, error: msg }, 'Failed to process email')
      result.errors.push(`Email ${msgId}: ${msg}`)
    }
  }

  return result
}
