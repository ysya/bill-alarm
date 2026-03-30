import type { ParsedBill } from '@bill-alarm/shared/types'

export interface BillEmailParser {
  bankCode: string
  parse(text: string): ParsedBill | null
}

export type { ParsedBill }
