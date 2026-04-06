import type { BillEmailParser } from './types.js'
import { parseAmount } from './utils.js'

/**
 * 滙豐銀行帳單解析器
 *
 * PDF 特徵：欄位標籤是圖片，mupdf 只能擷取純數字。
 * 可靠的定位點：
 * - 第一個 YYYY/MM/DD = 繳費截止日
 * - 底部 `金額\nYYYY\nMM\nDD\n,` = 應繳金額 + 截止日確認
 * - `金額\n最低應繳\n\n[16位卡號]` = 最低應繳金額
 * - 帳期 = 截止日的年月（HSBC 帳期與截止日同月）
 */
export const hsbcTwParser: BillEmailParser = {
  bankCode: 'hsbc_tw',

  parse(text) {
    const dueDate = extractDueDate(text)
    if (!dueDate) return null

    const amount = extractAmount(text) ?? extractAmountFromBottom(text)
    if (amount == null) return null

    return {
      amount,
      minimumPayment: extractMinimumPayment(text, amount),
      dueDate,
      billingPeriod: `${dueDate.getFullYear()}-${String(dueDate.getMonth() + 1).padStart(2, '0')}`,
    }
  },
}

/** 第一個 YYYY/MM/DD（西元年格式） */
function extractDueDate(text: string): Date | null {
  const match = text.match(/(\d{4})\/(\d{2})\/(\d{2})/)
  if (!match) return null
  const date = new Date(parseInt(match[1]), parseInt(match[2]) - 1, parseInt(match[3]))
  if (!isNaN(date.getTime()) && date.getFullYear() >= 2020) return date
  return null
}

/**
 * 底部格式：`金額\nYYYY\nMM\nDD\n,`
 * 這是應繳總額在匯總區的重複出現，非常穩定。
 */
function extractAmountFromBottom(text: string): number | null {
  const match = text.match(/([\d,]+)\n(\d{4})\n(\d{1,2})\n(\d{1,2})\n,/)
  if (match) return parseAmount(match[1])
  return null
}

/**
 * 表頭區：利率後的第 5 個數字 = 應繳金額
 * 格式：09.680%\n...\n[prev]\n[paid]\n[net]\n[new]\n[total]\n[min]
 */
function extractAmount(text: string): number | null {
  const rateIdx = text.indexOf('%')
  if (rateIdx === -1) return null

  const afterRate = text.substring(rateIdx + 1)
  const numbers: number[] = []
  for (const line of afterRate.split('\n')) {
    const trimmed = line.trim()
    if (/^-?[\d,]+$/.test(trimmed)) {
      numbers.push(parseAmount(trimmed))
      if (numbers.length === 6) break
    }
  }

  // 5th number = total amount due, 6th = minimum payment
  return numbers.length >= 5 ? numbers[4] : null
}

/**
 * 最低應繳：
 * 1. 表頭區利率後的第 6 個數字
 * 2. 備用：`應繳金額\n最低應繳\n\n[16位卡號]`
 */
function extractMinimumPayment(text: string, totalAmount: number): number | undefined {
  // 策略 1：表頭區第 6 個數字
  const rateIdx = text.indexOf('%')
  if (rateIdx !== -1) {
    const afterRate = text.substring(rateIdx + 1)
    const numbers: number[] = []
    for (const line of afterRate.split('\n')) {
      const trimmed = line.trim()
      if (/^-?[\d,]+$/.test(trimmed)) {
        numbers.push(parseAmount(trimmed))
        if (numbers.length === 6) break
      }
    }
    if (numbers.length >= 6 && numbers[5] > 0) return numbers[5]
  }

  // 策略 2：卡號前的兩個數字
  const cardMatch = text.match(/([\d,]+)\n([\d,]+)\n\n(\d{16})/)
  if (cardMatch) {
    const first = parseAmount(cardMatch[1])
    const second = parseAmount(cardMatch[2])
    if (first === totalAmount && second > 0) return second
  }

  return undefined
}
