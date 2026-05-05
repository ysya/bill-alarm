export interface NotificationRule {
  id: string
  name: string
  daysBefore: number
  timeOfDay: string
  channels: string[]
  isActive: boolean
}

export interface ConfigStatus {
  email: {
    provider: 'gmail-imap'
    hasCredentials: boolean
    isConnected: boolean
    message: string
    user: string | null
    host: string
    port: number
  }
  telegram: { isConfigured: boolean; chatId: string | null }
  calendar: { feedUrl: string; feedPath: string; token: string }
  scan: { interval: number; rangeDays: number; queryExtra: string }
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
