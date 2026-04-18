import type { ParsedBill } from '@bill-alarm/shared/types'
import type { TemplateParserConfig } from '@bill-alarm/shared/template-parser'
import type { BillEmailParser } from './types.js'
import { esunParser } from './esun.js'
import { yuantaParser } from './yuanta.js'
import { ctbcParser } from './ctbc.js'
import { taishinParser } from './taishin.js'
import { sinopacParser } from './sinopac.js'
import { ubotParser } from './ubot.js'
import { cathayParser } from './cathay.js'
import { hsbcTwParser } from './hsbc.js'
import { genericParser } from './generic.js'
import { parseWithTemplate } from './template.js'

const parsers = new Map<string, BillEmailParser>([
  [esunParser.bankCode, esunParser],
  [yuantaParser.bankCode, yuantaParser],
  [ctbcParser.bankCode, ctbcParser],
  [taishinParser.bankCode, taishinParser],
  [sinopacParser.bankCode, sinopacParser],
  [ubotParser.bankCode, ubotParser],
  [cathayParser.bankCode, cathayParser],
  [hsbcTwParser.bankCode, hsbcTwParser],
])

/** Get bank-specific parser, or generic fallback */
export function getParser(bankCode: string | null): BillEmailParser {
  return (bankCode && parsers.get(bankCode)) || genericParser
}

/** List all registered bank-specific parser codes (excluding generic) */
export function listParserCodes(): string[] {
  return Array.from(parsers.keys())
}

/**
 * Parse bill text using (in order): template config → hardcoded parser → generic fallback.
 * Returns which strategy produced the result so callers can log/display it.
 */
export function parseText(
  text: string,
  bankCode: string | null,
  parserConfig: string | null,
): { bill: ParsedBill | null; source: 'template' | 'hardcoded' | 'generic' } {
  if (parserConfig) {
    try {
      const config = JSON.parse(parserConfig) as TemplateParserConfig
      const bill = parseWithTemplate(text, config)
      if (bill) return { bill, source: 'template' }
    } catch {
      // invalid JSON — fall through
    }
  }

  const parser = getParser(bankCode)
  const bill = parser.parse(text)
  return { bill, source: parser === genericParser ? 'generic' : 'hardcoded' }
}
