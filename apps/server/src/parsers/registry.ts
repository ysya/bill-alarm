import type { BillEmailParser } from './types.js'
import { esunParser } from './esun.js'
import { yuantaParser } from './yuanta.js'
import { ctbcParser } from './ctbc.js'
import { taishinParser } from './taishin.js'
import { sinopacParser } from './sinopac.js'
import { ubotParser } from './ubot.js'
import { cathayParser } from './cathay.js'
import { hsbcTwParser } from './hsbc.js'

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

/** Bank-specific parser only — null when the bank has none (no generic fallback). */
export function getHardcodedParser(bankCode: string | null): BillEmailParser | null {
  return (bankCode && parsers.get(bankCode)) || null
}

/** List all registered bank-specific parser codes (excluding generic) */
export function listParserCodes(): string[] {
  return Array.from(parsers.keys())
}
