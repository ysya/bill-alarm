import { GoogleGenAI } from '@google/genai'
import { getSetting, KEYS } from './settings.js'
import type { ParsedBill } from '@bill-alarm/shared/types'
import type { FieldRule, FieldType } from '@bill-alarm/shared/template-parser'

export enum LlmProvider {
  None = 'none',
  Gemini = 'gemini',
  OpenAI = 'openai',
  Ollama = 'ollama',
}

const BILL_PROMPT = `You extract structured data from a Taiwan credit card bill.

Conventions:
- Amounts are NTD integers (drop commas and decimals). Preserve sign: a negative amount means overpayment/credit.
- Dates use Gregorian YYYY-MM-DD. Taiwan ROC years (民國) are Gregorian year - 1911 (e.g. 115 = 2026).
- billingPeriod is YYYY-MM and refers to the statement period, NOT the due date. Look near terms like 信用卡/帳單/消費明細/對帳單 for phrases such as "115年02月" or "2026年02月". If the bill only states a single month for the statement, use it. Do not derive billingPeriod from the due date.
- If a field is not present or cannot be determined, return null for that field.

Bank: {bankName}

Bill text:
{text}`

const RULE_SUGGEST_PROMPT = `You help infer an extraction rule from a bill's PDF text.

The user selected a substring "{value}" which represents the "{fieldLabel}" field.

Return:
- keyword: the best Chinese anchor label that appears before the value (e.g. 本期應繳總額, 繳款截止日)
- type: one of "amount" (e.g. 1,234), "rocDate" (ROC date like 115/04/03), "adDate" (Gregorian date like 2026/04/03), "yearMonth" (e.g. 115年03月)
- nth: 1-based index of the value among same-type matches that follow the keyword

PDF text:
{text}

User selection start offset (within the text above): {startIndex}`

// JSON Schemas shared by Gemini (via responseJsonSchema) and Ollama (via format)
const BILL_SCHEMA = {
  type: 'object',
  properties: {
    amount: { type: ['integer', 'null'], description: 'Total amount due in NTD. Negative means overpayment/credit.' },
    minimumPayment: { type: ['integer', 'null'], description: 'Minimum payment in NTD.' },
    dueDate: { type: ['string', 'null'], description: 'Payment due date in YYYY-MM-DD (Gregorian).' },
    billingPeriod: { type: ['string', 'null'], description: 'Billing period in YYYY-MM (Gregorian).' },
  },
  required: ['amount', 'minimumPayment', 'dueDate', 'billingPeriod'],
} as const

const RULE_SCHEMA = {
  type: 'object',
  properties: {
    keyword: { type: 'string' },
    type: { type: 'string', enum: ['amount', 'rocDate', 'adDate', 'yearMonth'] },
    nth: { type: 'integer', minimum: 1 },
  },
  required: ['keyword', 'type', 'nth'],
} as const

// --- Provider selection ---
export async function getLlmProvider(): Promise<LlmProvider> {
  const raw = await getSetting(KEYS.LLM_PROVIDER)
  if (raw && (Object.values(LlmProvider) as string[]).includes(raw)) {
    return raw as LlmProvider
  }
  return LlmProvider.None
}

// --- Bill parsing (fallback) ---
export async function parseBillWithLLM(text: string, bankName: string): Promise<ParsedBill | null> {
  const provider = await getLlmProvider()
  if (provider === LlmProvider.None) throw new Error('LLM provider not configured')

  const prompt = BILL_PROMPT
    .replace('{bankName}', bankName)
    .replace('{text}', text.substring(0, 8000))

  const raw = await invokeLlm(provider, prompt, BILL_SCHEMA)
  return parseBillResponse(raw)
}

// --- Rule inference helper (for "AI suggest rule" in editor) ---
export async function suggestRuleWithLLM(
  text: string,
  value: string,
  startIndex: number,
  fieldLabel: string,
): Promise<FieldRule | null> {
  const provider = await getLlmProvider()
  if (provider === LlmProvider.None) throw new Error('LLM provider not configured')

  const contextStart = Math.max(0, startIndex - 200)
  const contextEnd = Math.min(text.length, startIndex + value.length + 100)
  const context = text.slice(contextStart, contextEnd)

  const prompt = RULE_SUGGEST_PROMPT
    .replace('{value}', value)
    .replace('{fieldLabel}', fieldLabel)
    .replace('{text}', context)
    .replace('{startIndex}', String(startIndex - contextStart))

  const raw = await invokeLlm(provider, prompt, RULE_SCHEMA)
  return parseRuleResponse(raw)
}

// --- Connection test (plain text, no schema) ---
export async function testLlmConnection(provider: LlmProvider): Promise<{ ok: boolean; message: string }> {
  try {
    const response = await invokeLlmPlain(provider, 'Reply with just the word "OK".')
    return { ok: true, message: `連線成功 (回應: ${response.slice(0, 50)})` }
  } catch (e) {
    return { ok: false, message: (e as Error).message }
  }
}

// --- Provider implementations ---
async function invokeLlm(provider: LlmProvider, prompt: string, schema: object): Promise<string> {
  if (provider === LlmProvider.Gemini) return invokeGemini(prompt, schema)
  if (provider === LlmProvider.OpenAI) return invokeOpenAI(prompt, schema)
  if (provider === LlmProvider.Ollama) return invokeOllama(prompt, schema)
  throw new Error('Invalid LLM provider')
}

async function invokeLlmPlain(provider: LlmProvider, prompt: string): Promise<string> {
  if (provider === LlmProvider.Gemini) return invokeGemini(prompt)
  if (provider === LlmProvider.OpenAI) return invokeOpenAI(prompt)
  if (provider === LlmProvider.Ollama) return invokeOllama(prompt)
  throw new Error('Invalid LLM provider')
}

async function invokeGemini(prompt: string, schema?: object): Promise<string> {
  const apiKey = await getSetting(KEYS.GEMINI_API_KEY)
  if (!apiKey) throw new Error('Gemini API key 未設定')
  const model = (await getSetting(KEYS.GEMINI_MODEL)) ?? 'gemini-2.5-flash'

  const ai = new GoogleGenAI({ apiKey })
  const response = await ai.models.generateContent({
    model,
    contents: prompt,
    ...(schema && {
      config: {
        responseMimeType: 'application/json',
        responseJsonSchema: schema,
      },
    }),
  })
  return response.text?.trim() ?? ''
}

async function invokeOpenAI(prompt: string, schema?: object): Promise<string> {
  const apiKey = await getSetting(KEYS.OPENAI_API_KEY)
  if (!apiKey) throw new Error('OpenAI API key 未設定')
  const model = (await getSetting(KEYS.OPENAI_MODEL)) ?? 'gpt-4o-mini'
  const baseUrl = ((await getSetting(KEYS.OPENAI_BASE_URL)) ?? 'https://api.openai.com/v1').replace(/\/$/, '')

  const body: Record<string, unknown> = {
    model,
    messages: [{ role: 'user', content: prompt }],
  }
  if (schema) {
    body.response_format = {
      type: 'json_schema',
      json_schema: {
        name: 'extraction',
        strict: true,
        schema: { ...schema, additionalProperties: false },
      },
    }
  }

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const txt = await res.text().catch(() => '')
    throw new Error(`OpenAI 請求失敗 (${res.status}): ${txt || res.statusText}`)
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>
  }
  return (data.choices?.[0]?.message?.content ?? '').trim()
}

async function invokeOllama(prompt: string, schema?: object): Promise<string> {
  const baseUrl = (await getSetting(KEYS.OLLAMA_BASE_URL)) ?? 'http://localhost:11434'
  const model = (await getSetting(KEYS.OLLAMA_MODEL)) ?? 'qwen2.5:1.5b'

  const url = `${baseUrl.replace(/\/$/, '')}/api/generate`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      prompt,
      stream: false,
      ...(schema && { format: schema }),
      options: { temperature: 0.1 },
    }),
  })

  if (!res.ok) {
    const txt = await res.text().catch(() => '')
    throw new Error(`Ollama 請求失敗 (${res.status}): ${txt || res.statusText}`)
  }
  const data = (await res.json()) as { response?: string }
  return (data.response ?? '').trim()
}

// --- Response parsing ---
function parseBillResponse(raw: string): ParsedBill | null {
  if (!raw) return null
  try {
    const data = JSON.parse(raw)
    if (data.amount == null || !data.dueDate) return null

    const dueDate = new Date(data.dueDate)
    if (isNaN(dueDate.getTime())) return null

    let billingPeriod: string
    if (typeof data.billingPeriod === 'string' && /^\d{4}-\d{2}$/.test(data.billingPeriod)) {
      billingPeriod = data.billingPeriod
    } else {
      const d = new Date(dueDate)
      d.setMonth(d.getMonth() - 1)
      billingPeriod = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    }

    return {
      amount: Math.round(data.amount),
      minimumPayment: data.minimumPayment != null ? Math.round(data.minimumPayment) : undefined,
      dueDate,
      billingPeriod,
    }
  } catch {
    return null
  }
}

function parseRuleResponse(raw: string): FieldRule | null {
  if (!raw) return null
  try {
    const data = JSON.parse(raw) as { keyword?: string; type?: string; nth?: number }
    const validTypes: FieldType[] = ['amount', 'rocDate', 'adDate', 'yearMonth']
    if (!data.keyword || !data.type || !validTypes.includes(data.type as FieldType)) return null
    return {
      keyword: data.keyword,
      type: data.type as FieldType,
      nth: Math.max(1, Math.floor(data.nth ?? 1)),
    }
  } catch {
    return null
  }
}
