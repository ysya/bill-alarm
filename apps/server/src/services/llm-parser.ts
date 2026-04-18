import { GoogleGenAI } from '@google/genai'
import { getSetting, KEYS } from './settings.js'
import type { ParsedBill } from '@bill-alarm/shared/types'
import type { FieldRule, FieldType } from '@bill-alarm/shared/template-parser'

export type LlmProvider = 'none' | 'gemini' | 'ollama'

const BILL_PROMPT = `你是台灣信用卡帳單解析器。從以下帳單文字中擷取資訊。

規則：
- 金額為新台幣整數（去掉逗號和小數點）
- 日期格式為 YYYY-MM-DD
- 如果找不到某個欄位，該欄位回傳 null
- 只回傳 JSON，不要任何其他文字或 markdown

回傳格式：
{"amount": 12345, "minimumPayment": 1234, "dueDate": "2026-04-15"}

銀行：{bankName}

帳單內容：
{text}`

const RULE_SUGGEST_PROMPT = `你幫使用者從 PDF 帳單文字中推斷解析規則。

使用者已選取一段文字：「{value}」，這個值代表「{fieldLabel}」。

請回傳一個 JSON 物件，包含：
- keyword: 前方最適合當錨點的中文關鍵字（通常是標籤，如「本期應繳總額」「繳款截止日」）
- type: 值的格式，可選 "amount" (數字金額如 1,234)、"rocDate" (民國年 115/04/03)、"adDate" (西元年 2026/04/03)、"yearMonth" (年月 如 115年03月)
- nth: 從 keyword 之後數，這個值是同類型 pattern 中的第幾個（從 1 開始）

只回傳 JSON，不要任何其他文字或 markdown。

PDF 文字：
{text}

使用者選取的起始位置：{startIndex}

回傳格式範例：
{"keyword": "本期應繳總額", "type": "amount", "nth": 1}`

// --- Provider selection ---
export async function getLlmProvider(): Promise<LlmProvider> {
  const raw = (await getSetting(KEYS.LLM_PROVIDER)) ?? 'none'
  if (raw === 'gemini' || raw === 'ollama') return raw
  return 'none'
}

// --- Bill parsing (fallback) ---
export async function parseBillWithLLM(text: string, bankName: string): Promise<ParsedBill | null> {
  const provider = await getLlmProvider()
  if (provider === 'none') throw new Error('LLM provider not configured')

  const prompt = BILL_PROMPT
    .replace('{bankName}', bankName)
    .replace('{text}', text.substring(0, 8000))

  const raw = await invokeLlm(provider, prompt)
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
  if (provider === 'none') throw new Error('LLM provider not configured')

  // Limit text context around the selection to save tokens
  const contextStart = Math.max(0, startIndex - 200)
  const contextEnd = Math.min(text.length, startIndex + value.length + 100)
  const context = text.slice(contextStart, contextEnd)

  const prompt = RULE_SUGGEST_PROMPT
    .replace('{value}', value)
    .replace('{fieldLabel}', fieldLabel)
    .replace('{text}', context)
    .replace('{startIndex}', String(startIndex - contextStart))

  const raw = await invokeLlm(provider, prompt)
  return parseRuleResponse(raw)
}

// --- Connection test ---
export async function testLlmConnection(provider: LlmProvider): Promise<{ ok: boolean; message: string }> {
  try {
    const response = await invokeLlm(provider, '回應 "OK" 兩個字母，不要其他內容。')
    return { ok: true, message: `連線成功 (回應: ${response.slice(0, 50)})` }
  } catch (e) {
    return { ok: false, message: (e as Error).message }
  }
}

// --- Provider implementations ---
async function invokeLlm(provider: LlmProvider, prompt: string): Promise<string> {
  if (provider === 'gemini') return invokeGemini(prompt)
  if (provider === 'ollama') return invokeOllama(prompt)
  throw new Error('Invalid LLM provider')
}

async function invokeGemini(prompt: string): Promise<string> {
  const apiKey = await getSetting(KEYS.GEMINI_API_KEY)
  if (!apiKey) throw new Error('Gemini API key 未設定')
  const model = (await getSetting(KEYS.GEMINI_MODEL)) ?? 'gemini-2.5-flash'

  const ai = new GoogleGenAI({ apiKey })
  const response = await ai.models.generateContent({
    model,
    contents: prompt,
  })
  return response.text?.trim() ?? ''
}

async function invokeOllama(prompt: string): Promise<string> {
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
      format: 'json',
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
function stripFences(s: string): string {
  return s.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim()
}

function parseBillResponse(raw: string): ParsedBill | null {
  if (!raw) return null
  try {
    const data = JSON.parse(stripFences(raw))
    if (!data.amount || !data.dueDate) return null

    const dueDate = new Date(data.dueDate)
    if (isNaN(dueDate.getTime())) return null

    const billMonth = new Date(dueDate)
    billMonth.setMonth(billMonth.getMonth() - 1)
    const billingPeriod = `${billMonth.getFullYear()}-${String(billMonth.getMonth() + 1).padStart(2, '0')}`

    return {
      amount: Math.round(data.amount),
      minimumPayment: data.minimumPayment ? Math.round(data.minimumPayment) : undefined,
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
    const data = JSON.parse(stripFences(raw)) as { keyword?: string; type?: string; nth?: number }
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
