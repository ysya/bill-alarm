import fs from 'node:fs/promises'
import path from 'node:path'
import { PDF_DIR } from '@/paths.js'
import { logger } from '@/index.js'
import prisma from '@/prisma.js'
import { getEmailProviderFor, type MailboxOwner } from './email/index.js'
import { extractPdfText, getPdfBuffers } from './pdf-parser.js'
import { parseWithTemplate } from '@/parsers/template.js'
import { getHardcodedParser } from '@/parsers/registry.js'
import type { TemplateParserConfig } from '@bill-alarm/shared/template-parser'
import { parseBillWithLLM, getLlmProvider, LlmProvider } from './llm-parser.js'
import { getSetting, KEYS } from './settings.js'
import { scanEvents } from './scan-events.js'
import type { Bill, Bank } from '../../generated/prisma/client.js'
import { BillStatus, type ParsedBill } from '@bill-alarm/shared/types'
import { daysUntil } from '@bill-alarm/shared/date'
import type { ScanError, ScanItemStatus } from '@bill-alarm/shared/scan'

export type { ScanError }

export type ScanUser = { id: string } & MailboxOwner

export interface ScanResult {
  scanned: number
  newBills: Array<{ bill: Bill; bank: Bank }>
  errors: ScanError[]
}

export interface ScanCallbacks {
  /** Called once after Gmail search completes, with total messages to process. */
  onStart?: (total: number) => void
  /** Called after each email is processed (1-based idx). */
  onProgress?: (idx: number, total: number, bank: string | undefined, status: ScanItemStatus, reason?: string) => void
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
  const days = daysUntil(parsed.dueDate)
  if (days < -90) return '繳款截止日在過去 90 天以前'
  if (days > 90) return '繳款截止日超過未來 90 天'
  return null
}

/** True if this email already produced a bill for THIS user (per-user stable-ID dedup). */
export async function emailAlreadyProcessed(msgId: string, userId: string): Promise<boolean> {
  return (await prisma.bill.count({ where: { sourceEmailId: msgId, bank: { userId } } })) > 0
}

/** True if a bill with the same bank/amount/dueDate exists — catches the same
 *  statement re-ingested under a different email ID (e.g. provider migration). */
export async function duplicateBillExists(bankId: string, amount: number, dueDate: string): Promise<boolean> {
  return (await prisma.bill.count({ where: { bankId, amount, dueDate } })) > 0
}

export async function scanAndProcessEmails(user: ScanUser, callbacks?: ScanCallbacks): Promise<ScanResult> {
  const result: ScanResult = { scanned: 0, newBills: [], errors: [] }

  // Mailbox is the more fundamental prerequisite: check it before spending a
  // query on banks, and report it even when the user has no banks configured.
  const provider = getEmailProviderFor(user)
  if (!provider) {
    result.errors.push({
      stage: 'email_search',
      reason: '信箱未設定（請至設定頁填入 IMAP 帳密）',
    })
    callbacks?.onStart?.(0)
    return result
  }

  const banks = await prisma.bank.findMany({ where: { isActive: true, userId: user.id } })
  if (banks.length === 0) {
    callbacks?.onStart?.(0)
    return result
  }

  const senderPatterns = banks.map((b) => `from:(${b.emailSenderPattern})`).join(' OR ')
  const rangeDaysRaw = await getSetting(KEYS.SCAN_RANGE_DAYS)
  const rangeDays = rangeDaysRaw ? Math.max(1, parseInt(rangeDaysRaw)) : 60
  const extraQuery = (await getSetting(KEYS.SCAN_GMAIL_QUERY_EXTRA)) || ''
  const query = `(${senderPatterns}) newer_than:${rangeDays}d has:attachment${extraQuery ? ` ${extraQuery.trim()}` : ''}`

  logger.info({ query, rangeDays }, 'Email scan query')

  try {
    return await provider.withSession(async (session) => {
      let messageRefs: { id: string }[]
      try {
        messageRefs = await session.search({ query, sinceDays: rangeDays })
      } catch (e) {
        result.errors.push({
          stage: 'email_search',
          reason: `郵件搜尋失敗：${(e as Error).message}`,
        })
        callbacks?.onStart?.(0)
        return result
      }

      result.scanned = messageRefs.length
      logger.info({ count: messageRefs.length }, 'Found emails to process')
      callbacks?.onStart?.(messageRefs.length)

      for (let i = 0; i < messageRefs.length; i++) {
        const msgRef = messageRefs[i]
        const msgId = msgRef.id
        const idx = i + 1
        const total = messageRefs.length
        let progressBank: string | undefined
        let progressStatus: ScanItemStatus = 'skipped'
        let progressReason: string | undefined
        try {
          if (await emailAlreadyProcessed(msgId, user.id)) {
            progressReason = '此信件已建立過帳單'
            continue
          }
          const email = await session.fetch(msgRef)
          if (!email) {
            progressReason = '取信失敗或郵件不存在'
            continue
          }

          const bank = banks.find((b) =>
            email.from.toLowerCase().includes(b.emailSenderPattern.toLowerCase()) &&
            email.subject.includes(b.emailSubjectPattern),
          )
          if (!bank) {
            progressReason = '無對應銀行'
            continue
          }
          progressBank = bank.name
          progressStatus = 'matched'

          const pdfBuffers = await getPdfBuffers(email.attachments)
          if (pdfBuffers.length === 0) {
            logger.debug({ msgId, bank: bank.name }, 'No PDF attachments found')
            progressReason = '無 PDF 附件'
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
            const reason = isPasswordError
              ? 'PDF 密碼錯誤，請至銀行管理更新密碼'
              : `PDF 文字擷取失敗${lastPdfError ? `（${lastPdfError}）` : ''}`
            result.errors.push({
              stage: isPasswordError ? 'pdf_password' : 'pdf_extract',
              bank: bank.name,
              msgId,
              reason,
            })
            progressStatus = 'error'
            progressReason = reason
            continue
          }

          let parsed: ParsedBill | null = null
          let source: 'template' | 'hardcoded' | 'llm' | null = null

          if (bank.parserConfig) {
            try {
              const config = JSON.parse(bank.parserConfig) as TemplateParserConfig
              const r = parseWithTemplate(pdfText, config)
              if (r) {
                parsed = r
                source = 'template'
              }
            } catch (e) {
              logger.warn({ bank: bank.name, error: (e as Error).message }, 'Template parse failed, falling back to LLM')
            }
          }

          if (!parsed) {
            const hardcoded = getHardcodedParser(bank.code)
            if (hardcoded) {
              const bill = hardcoded.parse(pdfText)
              if (bill) {
                parsed = bill
                source = 'hardcoded'
              }
            }
          }

          if (!parsed) {
            const llmProvider = await getLlmProvider()
            if (llmProvider === LlmProvider.None) {
              const reason = 'LLM 未設定，無法解析帳單。請至設定 → LLM 啟用 Gemini 或 Ollama'
              result.errors.push({ stage: 'parse_failed', bank: bank.name, msgId, reason })
              progressStatus = 'error'
              progressReason = reason
              continue
            }
            try {
              parsed = await parseBillWithLLM(pdfText, bank.name)
              if (parsed) source = 'llm'
            } catch (e) {
              const reason = `LLM 解析失敗：${(e as Error).message}`
              result.errors.push({ stage: 'parse_failed', bank: bank.name, msgId, reason })
              progressStatus = 'error'
              progressReason = reason
              continue
            }
          }

          if (!parsed) {
            const reason = 'LLM 回傳結果無法解析為有效帳單'
            result.errors.push({ stage: 'parse_failed', bank: bank.name, msgId, reason })
            progressStatus = 'error'
            progressReason = reason
            continue
          }

          const sanityErr = sanityCheck(parsed)
          if (sanityErr) {
            logger.warn({ bank: bank.name, source, parsed, error: sanityErr }, 'Parsed bill failed sanity check')
            const reason = `解析結果異常（${sanityErr}），請手動確認`
            result.errors.push({ stage: 'sanity_check', bank: bank.name, msgId, reason })
            progressStatus = 'error'
            progressReason = reason
          }

          const existing = await prisma.bill.findUnique({
            where: {
              bankId_billingPeriod: {
                bankId: bank.id,
                billingPeriod: parsed.billingPeriod,
              },
            },
          })
          if (existing) {
            progressReason = '已存在相同帳單'
            continue
          }

          if (await duplicateBillExists(bank.id, parsed.amount, parsed.dueDate)) {
            progressReason = '已存在同金額同到期日帳單'
            continue
          }

          let pdfPath: string | undefined
          if (matchedPdfBuf) {
            const filename = `${bank.id}_${msgId.replace(/[^A-Za-z0-9_-]/g, '')}.pdf`
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
              status: parsed.amount <= 0 ? BillStatus.NO_PAYMENT : BillStatus.PENDING,
              parseSource: source,
              sourceEmailId: msgId,
              rawEmailSnippet: pdfText.substring(0, 500),
              pdfPath,
            },
          })

          logger.info({ bank: bank.name, amount: parsed.amount, dueDate: parsed.dueDate }, 'New bill created')
          result.newBills.push({ bill, bank })
          if (progressStatus !== 'error') progressStatus = 'success'
        } catch (e) {
          const msg = (e as Error).message ?? String(e)
          logger.error({ msgId, error: msg }, 'Failed to process email')
          result.errors.push({ stage: 'unexpected', msgId, reason: msg })
          progressStatus = 'error'
          progressReason = msg
        } finally {
          callbacks?.onProgress?.(idx, total, progressBank, progressStatus, progressReason)
        }
      }

      return result
    })
  } catch (e) {
    result.errors.push({
      stage: 'email_search',
      reason: `信箱連線失敗：${(e as Error).message}`,
    })
    callbacks?.onStart?.(0)
    return result
  }
}

export interface RecordedScan {
  result: ScanResult
  scanLogId: string
}

/**
 * Run a scan and persist a ScanLog row capturing counts + structured errors.
 * Caller is responsible for any post-scan side effects (notifications),
 * which can be appended via `appendScanLogErrors`.
 */
export async function runScanWithLog(trigger: 'manual' | 'cron', user: ScanUser): Promise<RecordedScan> {
  const log = await prisma.scanLog.create({
    data: { trigger, startedAt: new Date(), userId: user.id },
  })

  let result: ScanResult = { scanned: 0, newBills: [], errors: [] }
  let fatal: string | null = null
  try {
    result = await scanAndProcessEmails(user, {
      onStart: (total) => {
        scanEvents.emitEvent({ type: 'start', userId: user.id, scanLogId: log.id, total, trigger })
      },
      onProgress: (idx, total, bank, status, reason) => {
        scanEvents.emitEvent({ type: 'progress', userId: user.id, scanLogId: log.id, idx, total, bank, status, reason })
      },
    })
  } catch (e) {
    fatal = (e as Error).message ?? String(e)
    logger.error({ error: fatal }, 'Scan crashed unexpectedly')
  }

  await prisma.scanLog.update({
    where: { id: log.id },
    data: {
      finishedAt: new Date(),
      scanned: result.scanned,
      newBillsCount: result.newBills.length,
      errorCount: result.errors.length + (fatal ? 1 : 0),
      errors: result.errors.length > 0 ? JSON.stringify(result.errors) : null,
      fatalError: fatal,
    },
  })

  if (fatal) {
    // Surface as a structured error so callers see the same shape.
    result.errors.push({ stage: 'unexpected', reason: fatal })
  }

  scanEvents.emitEvent({
    type: 'complete',
    userId: user.id,
    scanLogId: log.id,
    scanned: result.scanned,
    newBills: result.newBills.length,
    errorCount: result.errors.length,
  })

  return { result, scanLogId: log.id }
}

/**
 * Append additional structured errors (e.g. notification failures) to an existing
 * ScanLog row. Merges with existing errors and updates errorCount.
 */
export async function appendScanLogErrors(scanLogId: string, extra: ScanError[]): Promise<void> {
  if (extra.length === 0) return
  const log = await prisma.scanLog.findUnique({ where: { id: scanLogId } })
  if (!log) return
  const existing: ScanError[] = log.errors ? JSON.parse(log.errors) : []
  const merged = [...existing, ...extra]
  await prisma.scanLog.update({
    where: { id: scanLogId },
    data: {
      errors: JSON.stringify(merged),
      errorCount: merged.length + (log.fatalError ? 1 : 0),
    },
  })
}
