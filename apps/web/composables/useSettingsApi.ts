export type ScanErrorStage =
  | 'gmail_search'
  | 'email_fetch'
  | 'pdf_password'
  | 'pdf_extract'
  | 'parse_failed'
  | 'sanity_check'
  | 'unexpected'
  | 'notification'

export interface ScanError {
  stage: ScanErrorStage
  reason: string
  bank?: string
  msgId?: string
}

export interface ScanLogDTO {
  id: string
  trigger: 'manual' | 'cron'
  startedAt: string
  finishedAt: string | null
  scanned: number
  newBillsCount: number
  errorCount: number
  errors: ScanError[]
  fatalError: string | null
}

export function useSettingsApi() {
  const { get, post, patch, del } = useApi()

  return {
    // Notification rules
    listRules: () => get<any[]>('/notification-rules'),
    createRule: (data: {
      name: string
      daysBefore: number
      timeOfDay: string
      channels: string[]
    }) => post<any>('/notification-rules', data),
    updateRule: (id: string, data: Record<string, unknown>) =>
      patch<any>(`/notification-rules/${id}`, data),
    deleteRule: (id: string) => del<any>(`/notification-rules/${id}`),

    // Integration status
    getIntegrationStatus: () => get<{
      gmail: { connected: boolean; message: string }
      telegram: { configured: boolean }
      calendar: { configured: boolean }
    }>('/integrations/status'),

    // Gmail
    triggerScan: () => post<{ scanLogId?: string; scanned: number; newBills: number; errors: ScanError[] }>('/gmail/scan'),

    listScanLogs: (limit = 20) =>
      get<{ logs: ScanLogDTO[] }>(`/scan-logs?limit=${limit}`),

    // Telegram
    testTelegram: () => post<{ success: boolean }>('/telegram/test'),

    // OAuth / Config
    getOAuthStatus: () => get<{
      google: { hasCredentials: boolean; isConnected: boolean; clientId: string | null }
      telegram: { isConfigured: boolean; chatId: string | null }
      calendar: { calendarId: string; enabled: boolean }
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
    }>('/oauth/status'),

    saveGoogleCredentials: (clientId: string, clientSecret: string) =>
      post<{ success: boolean }>('/oauth/google/credentials', { clientId, clientSecret }),

    startGoogleOAuth: () => get<{ url: string }>('/oauth/google/start'),

    disconnectGoogle: () => post<{ success: boolean }>('/oauth/google/disconnect'),

    saveTelegramConfig: (botToken: string, chatId: string) =>
      post<{ success: boolean }>('/oauth/telegram/config', { botToken, chatId }),

    saveCalendarConfig: (calendarId: string) =>
      post<{ success: boolean }>('/oauth/calendar/config', { calendarId }),

    toggleCalendar: (enabled: boolean) =>
      post<{ success: boolean; enabled: boolean }>('/oauth/calendar/toggle', { enabled }),

    saveScanInterval: (interval: number) =>
      post<{ success: boolean }>('/oauth/scan/config', { interval }),

    saveScanConfig: (data: { interval?: number; rangeDays?: number; queryExtra?: string }) =>
      post<{ success: boolean }>('/oauth/scan/config', data),

    saveGeminiConfig: (apiKey: string) =>
      post<{ success: boolean }>('/oauth/gemini/config', { apiKey }),

    saveOpenAIConfig: (apiKey: string) =>
      post<{ success: boolean }>('/oauth/openai/config', { apiKey }),

    saveLlmConfig: (data: {
      provider: 'none' | 'gemini' | 'openai' | 'ollama'
      geminiModel?: string
      openaiModel?: string
      openaiBaseUrl?: string
      ollamaBaseUrl?: string
      ollamaModel?: string
    }) => post<{ success: boolean }>('/oauth/llm/config', data),

    testLlm: () => post<{ ok: boolean; message: string }>('/llm/test'),
  }
}
