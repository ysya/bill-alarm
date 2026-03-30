import { GoogleGenAI } from '@google/genai'
import { getSetting, KEYS } from './settings.js'
import type { ParsedBill } from '@bill-alarm/shared/types'

const PROMPT = `你是台灣信用卡帳單解析器。從以下帳單文字中擷取資訊。

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

export async function parseBillWithLLM(text: string, bankName: string): Promise<ParsedBill | null> {
  const apiKey = await getSetting(KEYS.GEMINI_API_KEY)
  if (!apiKey) {
    throw new Error('Gemini API key not configured')
  }

  const ai = new GoogleGenAI({ apiKey })

  const prompt = PROMPT
    .replace('{bankName}', bankName)
    .replace('{text}', text.substring(0, 8000)) // Limit text length

  const response = await ai.models.generateContent({
    model: 'gemini-2.0-flash',
    contents: prompt,
  })

  const responseText = response.text?.trim()
  if (!responseText) return null

  // Clean up response (remove markdown code blocks if present)
  const jsonStr = responseText
    .replace(/^```json?\n?/i, '')
    .replace(/\n?```$/i, '')
    .trim()

  try {
    const data = JSON.parse(jsonStr)

    if (!data.amount || !data.dueDate) return null

    const dueDate = new Date(data.dueDate)
    if (isNaN(dueDate.getTime())) return null

    // Derive billing period from due date (usually previous month)
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
