import type { BillEmailParser } from './types.js'
import { parseAmount, parseDate, extractBillingPeriod, deriveBillingPeriod } from './utils.js'

/**
 * 元大銀行帳單解析器
 *
 * PDF 格式特徵（header 一行、值一行）：
 * 前期帳單總額 已繳款(含回饋/調整) 本期應繳總額 本期最低應繳金額 繳款截止日
 * -34,745 0 -24,117 0 115/03/26
 *
 * 帳期：「115年02月信用卡消費明細表」
 * 金額可能為負數（溢繳），取絕對值。
 */
export const yuantaParser: BillEmailParser = {
  bankCode: 'yuanta',

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
  const match = text.match(
    /前期帳單總額[\s\S]*?繳款截止日\n-?[\d,]+\s+-?[\d,]+\s+(-?[\d,]+)/,
  )
  if (match) {
    return parseAmount(match[1])
  }
  return null
}

function extractDueDate(text: string): Date | null {
  const match = text.match(
    /繳款截止日\n-?[\d,]+\s+-?[\d,]+\s+-?[\d,]+\s+-?[\d,]+\s+(\d{2,3})\/(\d{2})\/(\d{2})/,
  )
  if (match) {
    return parseDate(match[1], match[2], match[3])
  }
  return null
}

function extractMinimumPayment(text: string): number | undefined {
  const match = text.match(
    /前期帳單總額[\s\S]*?繳款截止日\n-?[\d,]+\s+-?[\d,]+\s+-?[\d,]+\s+([\d,]+)/,
  )
  if (match) {
    const amount = parseAmount(match[1])
    if (amount > 0) return amount
  }
  return undefined
}
