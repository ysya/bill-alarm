import type { BillEmailParser } from './types.js'
import { parseAmount, parseDate, deriveBillingPeriod } from './utils.js'

/**
 * 聯邦銀行帳單解析器
 *
 * PDF 格式特徵：
 * - 標題：「以下為您03月份之信用卡消費帳單：」
 * - 標題下一行：應繳總金額 最低應繳金額（空格分隔）
 * - 接續：繳款截止日（民國年 115/04/03）、結帳日
 */
export const ubotParser: BillEmailParser = {
  bankCode: 'ubot',

  parse(text) {
    const amount = extractAmount(text)
    const dueDate = extractDueDate(text)
    if (amount == null || !dueDate) return null

    return {
      amount,
      minimumPayment: extractMinimumPayment(text),
      dueDate,
      billingPeriod: deriveBillingPeriod(dueDate),
    }
  },
}

function extractAmount(text: string): number | null {
  // 標題下一行第一個數字為本期應繳總金額
  const match = text.match(/消費帳單[：:]\n([\d,]+)/)
  if (match) return parseAmount(match[1])
  return null
}

function extractDueDate(text: string): Date | null {
  // 標題下方的第一個民國年日期為繳款截止日
  const match = text.match(/消費帳單[：:]\n[\d,]+\s+[\d,]+\n(\d{3})\/(\d{2})\/(\d{2})/)
  if (match) return parseDate(match[1], match[2], match[3])
  // fallback: 第一個民國年日期
  const fallback = text.match(/(\d{3})\/(\d{2})\/(\d{2})/)
  if (fallback) return parseDate(fallback[1], fallback[2], fallback[3])
  return null
}

function extractMinimumPayment(text: string): number | undefined {
  // 標題下一行第二個數字為最低應繳金額
  const match = text.match(/消費帳單[：:]\n[\d,]+\s+([\d,]+)/)
  if (match) {
    const amount = parseAmount(match[1])
    if (amount > 0) return amount
  }
  return undefined
}
