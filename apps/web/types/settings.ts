export interface NotificationRule {
  id: string
  name: string
  daysBefore: number
  timeOfDay: string
  channels: string[]
  isActive: boolean
}

export interface OAuthStatus {
  google: { hasCredentials: boolean; isConnected: boolean; email: string | null }
  telegram: { isConfigured: boolean; chatId: string | null }
  calendar: { calendarId: string; enabled: boolean }
  scan: { interval: number; rangeDays: number; queryExtra: string }
  gemini: { isConfigured: boolean }
  llm: { provider: 'none' | 'gemini' | 'ollama'; geminiModel: string; ollamaBaseUrl: string; ollamaModel: string }
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
  { value: 'calendar', label: 'Google Calendar' },
] as const
