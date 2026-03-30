import type { BillEmailParser } from './types.js'
import { esunParser } from './esun.js'
import { yuantaParser } from './yuanta.js'
import { ctbcParser } from './ctbc.js'
import { taishinParser } from './taishin.js'
import { sinopacParser } from './sinopac.js'
import { genericParser } from './generic.js'

const parsers = new Map<string, BillEmailParser>([
  [esunParser.bankCode, esunParser],
  [yuantaParser.bankCode, yuantaParser],
  [ctbcParser.bankCode, ctbcParser],
  [taishinParser.bankCode, taishinParser],
  [sinopacParser.bankCode, sinopacParser],
])

/** Get bank-specific parser, or generic fallback */
export function getParser(bankCode: string | null): BillEmailParser {
  return (bankCode && parsers.get(bankCode)) || genericParser
}
