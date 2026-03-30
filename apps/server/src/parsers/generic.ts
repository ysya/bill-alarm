import type { BillEmailParser } from './types.js'
import { parseAmount, parseDate, extractBillingPeriod, deriveBillingPeriod } from './utils.js'

/**
 * 通用帳單解析器（fallback）
 *
 * 使用常見的台灣銀行帳單格式嘗試解析，
 * 當沒有對應的銀行專用解析器時使用。
 */
export const genericParser: BillEmailParser = {
  bankCode: '_generic',

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
    /本期應繳總?金額[：:\s]*\$?\s*NT?\$?\s*([\d,]+)/,
    /應繳金額[：:\s]*\$?\s*NT?\$?\s*([\d,]+)/,
    /本期應繳[：:\s]*\$?\s*NT?\$?\s*([\d,]+)/,
    /繳款幣別[\s\S]{0,100}?TWD\s+\d+\s+([\d,]{3,})/,
    /新臺幣[：:\s]*([\d,]+)\s*元/,
    /NT\$\s*([\d,]+)/,
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
  const patterns: Array<{ re: RegExp; groups: [number, number, number] }> = [
    { re: /(?:繳款截止日|繳費期限|最後繳款日|繳款期限|Payment\s*Due\s*Date)[：:\s]*(\d{4})[./\-](\d{1,2})[./\-](\d{1,2})/, groups: [1, 2, 3] },
    { re: /(?:繳款截止日|繳費期限|最後繳款日|繳款期限)[：:\s]*(\d{2,3})[./\-](\d{1,2})[./\-](\d{1,2})/, groups: [1, 2, 3] },
    { re: /(\d{4})[./\-](\d{1,2})[./\-](\d{1,2})\s*(?:前|止)/, groups: [1, 2, 3] },
    { re: /繳款[\s\S]{0,30}?(\d{4})[./\-](\d{1,2})[./\-](\d{1,2})/, groups: [1, 2, 3] },
    { re: /繳[款費][\s\S]{0,30}?(\d{2,3})[./\-](\d{1,2})[./\-](\d{1,2})/, groups: [1, 2, 3] },
  ]

  for (const { re, groups } of patterns) {
    const match = text.match(re)
    if (match) {
      const date = parseDate(match[groups[0]], match[groups[1]], match[groups[2]])
      if (date) return date
    }
  }
  return null
}

function extractMinimumPayment(text: string): number | undefined {
  const patterns = [
    /最低應繳[金額]*[：:\s]*\$?\s*NT?\$?\s*([\d,]+)/,
    /最低繳款[金額]*[：:\s]*\$?\s*NT?\$?\s*([\d,]+)/,
    /Minimum\s*(?:Payment|Due)[：:\s]*\$?\s*([\d,]+)/i,
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
