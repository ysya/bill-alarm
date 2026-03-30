import type { BillEmailParser } from './types.js'
import { esunParser } from './esun.js'
import { yuantaParser } from './yuanta.js'
import { ctbcParser } from './ctbc.js'
import { genericParser } from './generic.js'

const parsers = new Map<string, BillEmailParser>([
  [esunParser.bankCode, esunParser],
  [yuantaParser.bankCode, yuantaParser],
  [ctbcParser.bankCode, ctbcParser],
])

/** Get bank-specific parser, or generic fallback */
export function getParser(bankCode: string | null): BillEmailParser {
  return (bankCode && parsers.get(bankCode)) || genericParser
}
