export type { NotificationRuleDTO } from '@bill-alarm/shared/types'

export interface ConfigStatus {
  telegram: { isConfigured: boolean, boundCount: number }
  scan: { interval: number, rangeDays: number, queryExtra: string }
  gemini: { isConfigured: boolean }
  openai: { isConfigured: boolean }
  llm: {
    provider: 'none' | 'gemini' | 'openai' | 'ollama'
    geminiModel: string
    openaiModel: string
    openaiBaseUrl: string
    ollamaBaseUrl: string
    ollamaModel: string
  }
}

export interface EmailStatus {
  hasCredentials: boolean
  // Only present when fetched with getEmailStatus(true) (?verify=1) — the
  // default lazy fetch skips the live IMAP probe and omits these.
  connected?: boolean
  message?: string
  email?: string
  host: string
  port: number
  user: string | null
}

export const SCAN_INTERVAL_OPTIONS = [
  { value: '0', label: '關閉自動掃描' },
  { value: '1', label: '每 1 小時' },
  { value: '3', label: '每 3 小時' },
  { value: '6', label: '每 6 小時' },
  { value: '12', label: '每 12 小時' },
  { value: '24', label: '每 24 小時' },
] as const

export const CHANNEL_OPTIONS = [
  { value: 'telegram', label: 'Telegram' },
] as const

export const LLM_PROVIDER_LABELS: Record<'none' | 'gemini' | 'openai' | 'ollama', string> = {
  none: '未啟用',
  gemini: 'Gemini (雲端)',
  openai: 'OpenAI (雲端)',
  ollama: 'Ollama (本地)',
}
