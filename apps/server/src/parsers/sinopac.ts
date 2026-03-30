import type { BillEmailParser } from './types.js'
import { parseAmount, parseDate, extractBillingPeriod, deriveBillingPeriod } from './utils.js'

/**
 * 永豐銀行帳單解析器
 *
 * PDF 格式特徵：
 * - 標題行：「2026年3月 信用卡電子帳單」
 * - 繳款截止日用西元年：「您的繳款截止日2026/04/08」
 * - 臺幣明細表：臺幣 \t 上期應繳 \t 已繳款 \t 新增款項 \t 循環利息 \t 違約金 \t 本期應繳總金額 \t 最低應繳
 */
export const sinopacParser: BillEmailParser = {
  bankCode: 'sinopac',

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
  // 臺幣行：7 個欄位，第 6 欄為本期應繳總金額
  const match = text.match(/臺幣\s+[-\d,]+\s+[-\d,]+\s+[-\d,]+\s+[-\d,]+\s+[-\d,]+\s+([-\d,]+)\s+[-\d,]+/)
  if (match) return parseAmount(match[1])
  return null
}

function extractDueDate(text: string): Date | null {
  const match = text.match(/繳款截止日\s*(\d{4})\/(\d{2})\/(\d{2})/)
  if (match) return parseDate(match[1], match[2], match[3])
  return null
}

function extractMinimumPayment(text: string): number | undefined {
  // 臺幣行：第 7 欄為本期最低應繳金額
  const match = text.match(/臺幣\s+[-\d,]+\s+[-\d,]+\s+[-\d,]+\s+[-\d,]+\s+[-\d,]+\s+[-\d,]+\s+([\d,]+)/)
  if (match) {
    const amount = parseAmount(match[1])
    if (amount > 0) return amount
  }
  return undefined
}
