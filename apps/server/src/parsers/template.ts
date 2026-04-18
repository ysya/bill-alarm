import type { ParsedBill } from '@bill-alarm/shared/types'
import type {
  FieldRule,
  FieldType,
  TemplateParserConfig,
} from '@bill-alarm/shared/template-parser'
import { parseAmount, parseDate, parseYear, deriveBillingPeriod } from './utils.js'

const PATTERNS: Record<FieldType, RegExp> = {
  amount: /(-?[\d,]{2,})/g,
  rocDate: /(\d{2,3})\/(\d{1,2})\/(\d{1,2})/g,
  adDate: /(\d{4})\/(\d{1,2})\/(\d{1,2})/g,
  yearMonth: /(\d{2,4})\s*年\s*(\d{1,2})\s*月/g,
}

export interface MatchInfo {
  start: number
  end: number
  value: string
}

export interface RuleResult {
  match: RegExpMatchArray
  info: MatchInfo
}

/**
 * Find the nth match of rule.type after the keyword position.
 */
export function extractByRule(text: string, rule: FieldRule): RuleResult | null {
  if (!rule.keyword) return null
  const keywordIndex = text.indexOf(rule.keyword)
  if (keywordIndex === -1) return null

  const offset = keywordIndex + rule.keyword.length
  const searchText = text.slice(offset)
  const pattern = new RegExp(PATTERNS[rule.type].source, 'g')
  const nth = Math.max(1, rule.nth ?? 1)

  const allMatches = [...searchText.matchAll(pattern)]
  if (allMatches.length < nth) return null

  const match = allMatches[nth - 1]
  return {
    match,
    info: {
      start: offset + (match.index ?? 0),
      end: offset + (match.index ?? 0) + match[0].length,
      value: match[0],
    },
  }
}

function toAmount(result: RuleResult): number | null {
  const v = parseAmount(result.match[1])
  return Number.isFinite(v) ? v : null
}

function toDate(type: FieldType, result: RuleResult): Date | null {
  const m = result.match
  if (type === 'rocDate' || type === 'adDate') return parseDate(m[1], m[2], m[3])
  return null
}

function toYearMonth(result: RuleResult): string | null {
  const year = parseYear(result.match[1])
  const month = parseInt(result.match[2])
  if (year >= 2020 && month >= 1 && month <= 12) {
    return `${year}-${String(month).padStart(2, '0')}`
  }
  return null
}

export type FieldKey = 'amount' | 'dueDate' | 'minimumPayment' | 'billingPeriod'

export interface TemplateParseDetail {
  bill: ParsedBill | null
  matches: Partial<Record<FieldKey, MatchInfo>>
  errors: Partial<Record<FieldKey, string>>
}

/**
 * Parse using a template config. Returns detailed result for live-preview UI.
 */
export function parseWithTemplateDetailed(
  text: string,
  config: TemplateParserConfig,
): TemplateParseDetail {
  const matches: TemplateParseDetail['matches'] = {}
  const errors: TemplateParseDetail['errors'] = {}

  // amount
  const amountRes = extractByRule(text, config.amount)
  let amount: number | null = null
  if (!amountRes) {
    errors.amount = `找不到關鍵字「${config.amount.keyword}」後的第 ${config.amount.nth ?? 1} 個金額`
  } else {
    matches.amount = amountRes.info
    amount = toAmount(amountRes)
    if (amount == null) errors.amount = `匹配到的值「${amountRes.info.value}」無法解析為金額`
  }

  // dueDate
  const dueRes = extractByRule(text, config.dueDate)
  let dueDate: Date | null = null
  if (!dueRes) {
    errors.dueDate = `找不到關鍵字「${config.dueDate.keyword}」後的第 ${config.dueDate.nth ?? 1} 個日期`
  } else {
    matches.dueDate = dueRes.info
    dueDate = toDate(config.dueDate.type, dueRes)
    if (!dueDate) errors.dueDate = `匹配到的值「${dueRes.info.value}」無法解析為日期`
  }

  // minimumPayment (optional)
  let minimumPayment: number | undefined
  if (config.minimumPayment) {
    const minRes = extractByRule(text, config.minimumPayment)
    if (minRes) {
      matches.minimumPayment = minRes.info
      const v = toAmount(minRes)
      if (v != null && v > 0) minimumPayment = v
    }
  }

  // billingPeriod (optional)
  let billingPeriod: string | undefined
  if (config.billingPeriod) {
    const bpRes = extractByRule(text, config.billingPeriod)
    if (bpRes) {
      matches.billingPeriod = bpRes.info
      const v = toYearMonth(bpRes)
      if (v) billingPeriod = v
    }
  }

  let bill: ParsedBill | null = null
  if (amount != null && dueDate) {
    bill = {
      amount,
      minimumPayment,
      dueDate,
      billingPeriod: billingPeriod ?? deriveBillingPeriod(dueDate),
    }
  }

  return { bill, matches, errors }
}

/** Simple parse that returns ParsedBill or null. */
export function parseWithTemplate(text: string, config: TemplateParserConfig): ParsedBill | null {
  return parseWithTemplateDetailed(text, config).bill
}
