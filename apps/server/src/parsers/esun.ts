import type { BillEmailParser } from './types.js'
import { parseAmount, parseDate, extractBillingPeriod, deriveBillingPeriod } from './utils.js'

/**
 * 玉山銀行帳單解析器
 *
 * PDF 格式特徵：
 * - 金額行：TWD 0 69,988 69,988 6,999（第三個數字是應繳總金額）
 * - 日期行：N,NNN 元 接著 115/04/13
 * - 帳期：「115年02月 信用卡帳單」
 */
export const esunParser: BillEmailParser = {
  bankCode: 'esun',

  parse(text) {
    const amount = extractAmount(text)
    const dueDate = extractDueDate(text)
    if (amount == null || !dueDate) return null

    return {
      amount,
      minimumPayment: extractMinimumPayment(text),
      dueDate,
      billingPeriod: extractBillingPeriod(text) ?? deriveBillingPeriod(dueDate),
    }
  },
}

function extractAmount(text: string): number | null {
  const patterns = [
    // 表格行 TWD 0 69,988 69,988 6,999（第三個數字）
    /本期應繳總金額\s+本期最低應繳金額\nTWD\s+[\d,]+\s+([\d,]+)\s+[\d,]+/,
    // N,NNN 元 連續出現（第一個常是應繳）
    /([\d,]{3,})\s*元\n[\s\S]{0,20}?([\d,]{3,})\s*元/,
    // 標準格式
    /本期應繳總?金額[：:\s]*\$?\s*NT?\$?\s*([\d,]+)/,
    /應繳金額[：:\s]*\$?\s*NT?\$?\s*([\d,]+)/,
  ]

  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match) {
      const amount = parseAmount(match[1])
      if (amount > 0) return amount
    }
  }
  return null
}

function extractDueDate(text: string): Date | null {
  const patterns = [
    // N,NNN 元 後的民國年日期
    /(?:[\d,]+\s*元\n)([\d,]+)\s*元\n(\d{2,3})[./\-](\d{1,2})[./\-](\d{1,2})/,
    // 繳款截止日：115/04/15
    /(?:繳款截止日|繳費期限|最後繳款日)[：:\s]*(\d{2,3})[./\-](\d{1,2})[./\-](\d{1,2})/,
    // 獨立民國年日期
    /\n(\d{3})\/(\d{2})\/(\d{2})\n/,
  ]

  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match) {
      // pattern 1 有 4 groups (元, year, month, day)
      const [yearStr, monthStr, dayStr] = match.length === 5
        ? [match[2], match[3], match[4]]
        : [match[1], match[2], match[3]]
      const date = parseDate(yearStr, monthStr, dayStr)
      if (date) return date
    }
  }
  return null
}

function extractMinimumPayment(text: string): number | undefined {
  const patterns = [
    // TWD 表格最後一個數字
    /TWD\s+[\d,]+\s+[\d,]+\s+[\d,]+\s+([\d,]+)/,
    // N,NNN 元 連續出現（第二個）
    /[\d,]+\s*元\n([\d,]+)\s*元\n\d{2,3}[./\-]/,
    /最低應繳[金額]*[：:\s]*\$?\s*NT?\$?\s*([\d,]+)/,
  ]

  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match) {
      const amount = parseAmount(match[1])
      if (amount > 0) return amount
    }
  }
  return undefined
}
