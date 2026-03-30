import type { ParsedBill } from '@bill-alarm/shared/types'
import { logger } from '../index.js'

/**
 * Regex-based bill data extraction from PDF text.
 * Tries multiple common patterns used by Taiwan banks.
 */
export function extractBillFromText(text: string): ParsedBill | null {
  const amount = extractAmount(text)
  const dueDate = extractDueDate(text)

  if (!amount || !dueDate) return null

  const minimumPayment = extractMinimumPayment(text)
  const billingPeriod = deriveBillingPeriod(dueDate)

  logger.info({ amount, dueDate: dueDate.toISOString().split('T')[0], minimumPayment }, 'Regex extracted bill')

  return { amount, minimumPayment, dueDate, billingPeriod }
}

function extractAmount(text: string): number | null {
  const patterns = [
    // 標準格式：本期應繳金額 69,988
    /本期應繳總?金額[：:\s]*\$?\s*NT?\$?\s*([\d,]+)/,
    /應繳金額[：:\s]*\$?\s*NT?\$?\s*([\d,]+)/,
    /本期應繳[：:\s]*\$?\s*NT?\$?\s*([\d,]+)/,
    // 玉山格式：表格行 TWD 0 69,988 69,988 6,999（第三個數字是應繳總金額）
    /本期應繳總金額\s+本期最低應繳金額\nTWD\s+[\d,]+\s+([\d,]+)\s+[\d,]+/,
    // 寬鬆：TWD 後面第一個大於 100 的數字
    /繳款幣別[\s\S]{0,100}?TWD\s+\d+\s+([\d,]{3,})/,
    // N,NNN 元
    /([\d,]{3,})\s*元\n[\s\S]{0,20}?([\d,]{3,})\s*元/,
    // 新臺幣 XX 元
    /新臺幣[：:\s]*([\d,]+)\s*元/,
    // NT$ / TWD
    /NT\$\s*([\d,]+)/,
  ]

  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match) {
      const amount = parseInt(match[1].replace(/,/g, ''), 10)
      if (amount > 0) return amount
    }
  }
  return null
}

function extractDueDate(text: string): Date | null {
  const patterns = [
    // 繳款截止日：2026/04/15
    /(?:繳款截止日|繳費期限|最後繳款日|繳款期限|Payment\s*Due\s*Date)[：:\s]*(\d{4})[./\-](\d{1,2})[./\-](\d{1,2})/,
    // 繳款截止日：115/04/15 (ROC year with label)
    /(?:繳款截止日|繳費期限|最後繳款日|繳款期限)[：:\s]*(\d{2,3})[./\-](\d{1,2})[./\-](\d{1,2})/,
    // 2026/04/15 前 or 止
    /(\d{4})[./\-](\d{1,2})[./\-](\d{1,2})\s*(?:前|止)/,
    // 玉山格式：獨立的民國年日期 115/04/13（在金額附近）
    /(?:[\d,]+\s*元\n)([\d,]+)\s*元\n(\d{2,3})[./\-](\d{1,2})[./\-](\d{1,2})/,
    // 獨立民國年日期（三位數年/月/日，在帳單前半段）
    /\n(\d{3})\/(\d{2})\/(\d{2})\n/,
    // 繳款 附近的日期
    /繳款[\s\S]{0,30}?(\d{4})[./\-](\d{1,2})[./\-](\d{1,2})/,
    /繳[款費][\s\S]{0,30}?(\d{2,3})[./\-](\d{1,2})[./\-](\d{1,2})/,
  ]

  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match) {
      // 玉山格式 pattern 4 有 4 groups (元, year, month, day)
      let yearStr: string, monthStr: string, dayStr: string
      if (match.length === 5) {
        yearStr = match[2]; monthStr = match[3]; dayStr = match[4]
      } else {
        yearStr = match[1]; monthStr = match[2]; dayStr = match[3]
      }

      let year = parseInt(yearStr)
      const month = parseInt(monthStr)
      const day = parseInt(dayStr)

      // Handle ROC year (民國年)
      if (year < 200) year += 1911

      const date = new Date(year, month - 1, day)
      if (!isNaN(date.getTime()) && date.getFullYear() >= 2020) return date
    }
  }
  return null
}

function extractMinimumPayment(text: string): number | undefined {
  const patterns = [
    /最低應繳[金額]*[：:\s]*\$?\s*NT?\$?\s*([\d,]+)/,
    /最低繳款[金額]*[：:\s]*\$?\s*NT?\$?\s*([\d,]+)/,
    // 玉山表格格式：TWD 0 69,988 69,988 6,999（最後一個是最低應繳）
    /TWD\s+[\d,]+\s+[\d,]+\s+[\d,]+\s+([\d,]+)/,
    // N,NNN 元 連續出現（第二個常是最低應繳）
    /[\d,]+\s*元\n([\d,]+)\s*元\n\d{2,3}[./\-]/,
    /Minimum\s*(?:Payment|Due)[：:\s]*\$?\s*([\d,]+)/i,
  ]

  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match) {
      const amount = parseInt(match[1].replace(/,/g, ''), 10)
      if (amount > 0) return amount
    }
  }
  return undefined
}

function deriveBillingPeriod(dueDate: Date): string {
  const d = new Date(dueDate)
  d.setMonth(d.getMonth() - 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
