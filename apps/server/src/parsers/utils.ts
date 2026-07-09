import { ymdFromParts } from '@bill-alarm/shared/date'

export { deriveBillingPeriod } from '@bill-alarm/shared/date'

/** Parse y/m/d fragments (ROC or AD) into a 'YYYY-MM-DD' string, or null. */
export const parseDate = ymdFromParts

/** Parse a ROC or AD year string to AD year */
export function parseYear(yearStr: string): number {
  let year = parseInt(yearStr)
  if (year < 200) year += 1911
  return year
}

/** Parse a comma-separated number string to integer */
export function parseAmount(str: string): number {
  return parseInt(str.replace(/,/g, ''), 10)
}

/** Try matching patterns in order, return first match */
export function firstMatch(text: string, patterns: RegExp[]): RegExpMatchArray | null {
  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match) return match
  }
  return null
}

/** Extract billing period (年月) from text like "115年02月...信用卡" */
export function extractBillingPeriod(text: string): string | null {
  const patterns = [
    /(\d{2,3})\s*年\s*(\d{1,2})\s*月.*?(?:信用卡|帳單|消費明細)/,
    /(\d{4})\s*年\s*(\d{1,2})\s*月.*?(?:信用卡|帳單|消費明細)/,
  ]

  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match) {
      const year = parseYear(match[1])
      const month = parseInt(match[2])
      if (year >= 2020 && month >= 1 && month <= 12) {
        return `${year}-${String(month).padStart(2, '0')}`
      }
    }
  }
  return null
}
