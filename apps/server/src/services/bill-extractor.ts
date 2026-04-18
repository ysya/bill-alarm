import type { ParsedBill } from '@bill-alarm/shared/types'
import { logger } from '@/index.js'
import { parseText } from '@/parsers/registry.js'

export type ParseSource = 'template' | 'hardcoded' | 'generic' | 'llm'

export interface ExtractResult {
  bill: ParsedBill
  source: ParseSource
}

/**
 * Extract bill data from PDF text.
 * Order: template config (from DB) → hardcoded parser → generic fallback.
 * Returns both the parsed bill and which strategy produced it.
 */
export function extractBillFromText(
  text: string,
  bankCode?: string | null,
  parserConfig?: string | null,
): ExtractResult | null {
  const { bill, source } = parseText(text, bankCode ?? null, parserConfig ?? null)
  if (!bill) return null

  logger.info(
    {
      source,
      bankCode,
      amount: bill.amount,
      dueDate: bill.dueDate.toISOString().split('T')[0],
    },
    'Bill parsed successfully',
  )

  return { bill, source }
}
