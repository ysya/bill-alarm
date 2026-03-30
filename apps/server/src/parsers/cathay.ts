import type { BillEmailParser } from './types.js'
import { parseAmount, parseDate, parseYear, deriveBillingPeriod } from './utils.js'

/**
 * 國泰世華銀行帳單解析器
 *
 * PDF 格式特徵：
 * - 標題：「信用卡帳單 114年11月」
 * - 日期區塊：結帳日(114/11/02) → 繳款截止日(114/11/18) → 應繳金額 → 最低應繳
 * - 明細末尾：「本期應繳總額 757」
 * - TWD 摘要行：新臺幣TWD 上期 已繳 新增 利息 違約金 ??? 本期應繳
 * - 注意：繳款截止日與帳期同月（非次月），不可用 deriveBillingPeriod
 */
export const cathayParser: BillEmailParser = {
  bankCode: 'cathay',

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
  // 明細末尾：「本期應繳總額 757」
  const match = text.match(/本期應繳總額\s*([\d,]+)/)
  if (match) return parseAmount(match[1])
  return null
}

function extractDueDate(text: string): Date | null {
  // 日期區塊：結帳日後下一行為繳款截止日（民國年）
  const match = text.match(/\d{3}\/\d{2}\/\d{2}\n(\d{3})\/(\d{2})\/(\d{2})/)
  if (match) return parseDate(match[1], match[2], match[3])
  return null
}

function extractMinimumPayment(text: string): number | undefined {
  // 日期區塊：繳款截止日後第二個數字為最低應繳
  const match = text.match(/\d{3}\/\d{2}\/\d{2}\n\d{3}\/\d{2}\/\d{2}\n[\d,]+\n([\d,]+)/)
  if (match) {
    const amount = parseAmount(match[1])
    if (amount > 0) return amount
  }
  return undefined
}

function extractBillingPeriod(text: string): string | null {
  // 國泰格式：「信用卡帳單 114年11月」（帳單在前，年月在後）
  const match = text.match(/信用卡帳單\s*(\d{2,3})年(\d{1,2})月/)
  if (match) {
    const year = parseYear(match[1])
    const month = parseInt(match[2])
    if (year >= 2020 && month >= 1 && month <= 12) {
      return `${year}-${String(month).padStart(2, '0')}`
    }
  }
  return null
}
