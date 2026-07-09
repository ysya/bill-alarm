import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/services/llm-parser.js', () => ({
  LlmProvider: { None: 'none', Gemini: 'gemini', OpenAI: 'openai', Ollama: 'ollama' },
  getLlmProvider: vi.fn(async () => 'none'),
  parseBillWithLLM: vi.fn(async () => null),
}))

import { parseBill } from '@/services/bill-parser.js'
import { getLlmProvider, parseBillWithLLM } from '@/services/llm-parser.js'

// 玉山 hardcoded parser 能解的最小文字（取自 esun.ts 註解的表格格式）
const ESUN_TEXT = [
  '115年02月 信用卡帳單',
  '本期應繳總金額 本期最低應繳金額',
  'TWD 0 69,988 6,999',
  '繳款截止日：115/04/13',
].join('\n')

describe('parseBill chain', () => {
  beforeEach(() => vi.resetAllMocks())

  it('template config wins when it parses', async () => {
    const config = JSON.stringify({
      amount: { keyword: '本期應繳總金額', type: 'amount', nth: 2 },
      dueDate: { keyword: '繳款截止日', type: 'rocDate', nth: 1 },
    })
    const r = await parseBill(ESUN_TEXT, { code: 'esun', name: '玉山', parserConfig: config }, { allowLlm: false })
    expect(r.source).toBe('template')
    expect(r.bill?.dueDate).toBe('2026-04-13')
  })

  it('falls through invalid template JSON to hardcoded, recording the attempt', async () => {
    const r = await parseBill(ESUN_TEXT, { code: 'esun', name: '玉山', parserConfig: '{not json' }, { allowLlm: false })
    expect(r.source).toBe('hardcoded')
    expect(r.attempts).toEqual([{ source: 'template', error: expect.stringContaining('JSON') }])
  })

  it('unknown bank + llm disallowed -> null with attempts, llm never called', async () => {
    const r = await parseBill('隨便的文字', { code: null, name: 'X', parserConfig: null }, { allowLlm: false })
    expect(r.bill).toBeNull()
    expect(r.source).toBeNull()
    expect(parseBillWithLLM).not.toHaveBeenCalled()
  })

  it('llm allowed + provider configured -> llm result', async () => {
    vi.mocked(getLlmProvider).mockResolvedValue('gemini' as never)
    vi.mocked(parseBillWithLLM).mockResolvedValue({
      amount: 100, dueDate: '2026-08-01', billingPeriod: '2026-07',
    })
    const r = await parseBill('unparseable', { code: null, name: 'X', parserConfig: null }, { allowLlm: true })
    expect(r.source).toBe('llm')
    expect(r.bill?.amount).toBe(100)
  })

  it('llm allowed but provider none -> attempts record it, no throw', async () => {
    const r = await parseBill('unparseable', { code: null, name: 'X', parserConfig: null }, { allowLlm: true })
    expect(r.bill).toBeNull()
    expect(r.attempts.at(-1)).toEqual({ source: 'llm', error: expect.stringContaining('LLM 未設定') })
  })
})
