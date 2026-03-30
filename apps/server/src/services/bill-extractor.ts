import type { ParsedBill } from '@bill-alarm/shared/types'
import { logger } from '@/index.js'
import { getParser } from '@/parsers/registry.js'

/**
 * Extract bill data from PDF text.
 * Uses bank-specific parser when available, falls back to generic patterns.
 */
export function extractBillFromText(text: string, bankCode?: string | null): ParsedBill | null {
  const parser = getParser(bankCode ?? null)
  const result = parser.parse(text)

  if (result) {
    logger.info(
      { parser: parser.bankCode, amount: result.amount, dueDate: result.dueDate.toISOString().split('T')[0] },
      'Bill parsed successfully',
    )
  }

  return result
}
