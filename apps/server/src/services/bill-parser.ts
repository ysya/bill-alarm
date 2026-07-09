import type { ParsedBill } from '@bill-alarm/shared/types'
import type { TemplateParserConfig } from '@bill-alarm/shared/template-parser'
import { parseWithTemplate } from '@/parsers/template.js'
import { getHardcodedParser } from '@/parsers/registry.js'
import { parseBillWithLLM, getLlmProvider, LlmProvider } from './llm-parser.js'

export type ParseSource = 'template' | 'hardcoded' | 'llm'

export interface ParseAttempt {
  source: ParseSource
  error: string
}

export interface ParseOutcome {
  bill: ParsedBill | null
  source: ParseSource | null
  attempts: ParseAttempt[]
}

export interface ParseBankInfo {
  code: string | null
  name: string
  parserConfig: string | null
}

/**
 * The single bill-parsing chain: template -> hardcoded -> LLM.
 * Every caller (real scan and Parser Lab debug routes) goes through here,
 * so tested behaviour is deployed behaviour.
 */
export async function parseBill(
  text: string,
  bank: ParseBankInfo,
  opts: { allowLlm: boolean },
): Promise<ParseOutcome> {
  const attempts: ParseAttempt[] = []

  if (bank.parserConfig) {
    try {
      const config = JSON.parse(bank.parserConfig) as TemplateParserConfig
      const bill = parseWithTemplate(text, config)
      if (bill) return { bill, source: 'template', attempts }
      attempts.push({ source: 'template', error: '模板規則無法匹配欄位' })
    } catch (e) {
      attempts.push({ source: 'template', error: `模板設定 JSON 無效: ${(e as Error).message}` })
    }
  }

  const hardcoded = getHardcodedParser(bank.code)
  if (hardcoded) {
    const bill = hardcoded.parse(text)
    if (bill) return { bill, source: 'hardcoded', attempts }
    attempts.push({ source: 'hardcoded', error: '內建規則無法匹配欄位' })
  }

  if (opts.allowLlm) {
    if ((await getLlmProvider()) === LlmProvider.None) {
      attempts.push({ source: 'llm', error: 'LLM 未設定，無法解析帳單。請至設定 → LLM 啟用' })
      return { bill: null, source: null, attempts }
    }
    try {
      const bill = await parseBillWithLLM(text, bank.name)
      if (bill) return { bill, source: 'llm', attempts }
      attempts.push({ source: 'llm', error: 'LLM 回傳結果無法解析為有效帳單' })
    } catch (e) {
      attempts.push({ source: 'llm', error: `LLM 解析失敗：${(e as Error).message}` })
    }
  }

  return { bill: null, source: null, attempts }
}
