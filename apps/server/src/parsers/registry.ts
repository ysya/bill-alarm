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
