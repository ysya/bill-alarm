import type { BillEmailParser } from './types.js'
import { esunParser } from './esun.js'
import { yuantaParser } from './yuanta.js'
import { genericParser } from './generic.js'

const parsers = new Map<string, BillEmailParser>([
  [esunParser.bankCode, esunParser],
  [yuantaParser.bankCode, yuantaParser],
])

/** Get bank-specific parser, or generic fallback */
export function getParser(bankCode: string | null): BillEmailParser {
  return (bankCode && parsers.get(bankCode)) || genericParser
}
