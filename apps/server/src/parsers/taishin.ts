import type { BillEmailParser } from './types.js'
import { parseAmount, parseDate, extractBillingPeriod, deriveBillingPeriod } from './utils.js'

/**
 * 台新銀行帳單解析器
 *
 * PDF 格式特徵：
 * - Tab 分隔的 key-value 格式
 * - 繳款截止日\t115/04/13
 * - =本期累計應繳金額\t1,350
 * - 本期最低應繳金額\t1,000
 * - 帳期：115年 03月 信用卡電子帳單
 */
export const taishinParser: BillEmailParser = {
  bankCode: 'taishin',

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
    // =本期累計應繳金額\t1,350
    /=?本期累計應繳金額\s+(-?[\d,]+)/,
    // 本期應繳總額\t1,350
    /本期應繳總額\s+(-?[\d,]+)/,
  ]

  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match) {
      return parseAmount(match[1])
    }
  }
  return null
}

function extractDueDate(text: string): Date | null {
  // 繳款截止日\t115/04/13
  const match = text.match(/繳款截止日\s+(\d{2,3})\/(\d{2})\/(\d{2})/)
  if (match) {
    return parseDate(match[1], match[2], match[3])
  }
  return null
}

function extractMinimumPayment(text: string): number | undefined {
  // 本期最低應繳金額\t1,000
  const match = text.match(/本期最低應繳金額\s+(-?[\d,]+)/)
  if (match) {
    const amount = parseAmount(match[1])
    if (amount > 0) return amount
  }
  return undefined
}
