import type { BillEmailParser } from './types.js'
import { parseAmount, parseDate, deriveBillingPeriod, parseYear } from './utils.js'

/**
 * 中國信託銀行帳單解析器
 *
 * PDF 格式特徵：
 * - 表頭區塊依序為：帳期(115/03)、截止日(115/04/08)、應繳金額、最低應繳、額度
 * - 繳費單區：$7,833\n$1,000
 * - 彙總行：$7,833( ) $1,000( )
 */
export const ctbcParser: BillEmailParser = {
  bankCode: 'ctbc',

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
    // 表頭：截止日後下一行為應繳金額
    /\d{3}\/\d{2}\/\d{2}\n([\d,]+)\n[\d,]+\n[\d,]+\n/,
    // 繳費單：$金額
    /\$\s*([\d,]+)\n\$\s*[\d,]+\n/,
    // 彙總行：$7,833( ) $1,000( )
    /\$([\d,]+)\s*\(.*?\)\s*\$[\d,]+\s*\(/,
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
    // 表頭：115/04/08 後接金額行
    /(\d{3})\/(\d{2})\/(\d{2})\n[\d,]+\n[\d,]+\n/,
    // 獨立民國年日期
    /(\d{3})\/(\d{2})\/(\d{2})\n/,
  ]

  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match) {
      const date = parseDate(match[1], match[2], match[3])
      if (date) return date
    }
  }
  return null
}

function extractMinimumPayment(text: string): number | undefined {
  const patterns = [
    // 表頭：截止日 → 應繳金額 → 最低應繳
    /\d{3}\/\d{2}\/\d{2}\n[\d,]+\n([\d,]+)\n[\d,]+\n/,
    // 繳費單：第二個 $ 金額
    /\$\s*[\d,]+\n\$\s*([\d,]+)\n/,
    // 彙總行：第二個 $ 金額
    /\$[\d,]+\s*\(.*?\)\s*\$([\d,]+)\s*\(/,
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

function extractBillingPeriod(text: string): string | null {
  // 中信格式：115/03（民國年/月）
  const match = text.match(/(\d{3})\/(\d{2})\n/)
  if (match) {
    const year = parseYear(match[1])
    const month = parseInt(match[2])
    if (year >= 2020 && month >= 1 && month <= 12) {
      return `${year}-${String(month).padStart(2, '0')}`
    }
  }
  return null
}
