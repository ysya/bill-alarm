import type { EmailStatus } from '~/types/settings'

export type ScanErrorStage =
  | 'email_search'
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

export interface EmailConfigPayload {
  host?: string
  port?: number
  user: string
  password: string
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

    // Integration status (legacy overview)
    getIntegrationStatus: () => get<{
      email: { connected: boolean; message: string }
      telegram: { configured: boolean }
    }>('/integrations/status'),

    // Email scan
    triggerScan: () => post<{ scanLogId?: string; scanned: number; newBills: number; errors: ScanError[] }>('/email/scan'),

    listScanLogs: (limit = 20) =>
      get<{ logs: ScanLogDTO[] }>(`/scan-logs?limit=${limit}`),

    // Telegram
    testTelegram: () => post<{ success: boolean }>('/telegram/test'),

    // Email (IMAP)
    testEmailConnection: (data: EmailConfigPayload) =>
      post<{ ok: boolean; email?: string; error?: string }>('/email/test', {
        host: data.host ?? 'imap.gmail.com',
        port: data.port ?? 993,
        user: data.user,
        password: data.password,
      }),

    saveEmailConfig: (data: EmailConfigPayload) =>
      post<{ success: boolean }>('/email/save', {
        provider: 'gmail-imap',
        host: data.host ?? 'imap.gmail.com',
        port: data.port ?? 993,
        user: data.user,
        password: data.password,
      }),

    getEmailStatus: () => get<EmailStatus>('/email/status'),

    // Calendar (ICS feed)
    getCalendarFeed: () =>
      get<{ token: string; feedUrl: string; feedPath: string }>('/calendar/info'),

    rotateCalendarToken: () =>
      post<{ token: string; feedUrl: string; feedPath: string }>('/calendar/rotate'),

    // Aggregated config status
    getConfigStatus: () => get<{
      telegram: { isConfigured: boolean; boundCount: number }
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
    }>('/config/status'),

    saveTelegramConfig: (botToken: string) =>
      post<{ success: boolean }>('/config/telegram', { botToken }),

    // Telegram per-user binding
    telegramBind: () => post<{ deepLink: string; expiresAt: string }>('/auth/telegram/bind'),
    telegramConfirm: () => post<{ ok: boolean }>('/auth/telegram/confirm'),
    telegramUnbind: () => del<{ ok: boolean }>('/auth/telegram'),

    saveScanInterval: (interval: number) =>
      post<{ success: boolean }>('/config/scan', { interval }),

    saveScanConfig: (data: { interval?: number; rangeDays?: number; queryExtra?: string }) =>
      post<{ success: boolean }>('/config/scan', data),

    saveGeminiConfig: (apiKey: string) =>
      post<{ success: boolean }>('/config/gemini', { apiKey }),

    saveOpenAIConfig: (apiKey: string) =>
      post<{ success: boolean }>('/config/openai', { apiKey }),

    saveLlmConfig: (data: {
      provider: 'none' | 'gemini' | 'openai' | 'ollama'
      geminiModel?: string
      openaiModel?: string
      openaiBaseUrl?: string
      ollamaBaseUrl?: string
      ollamaModel?: string
    }) => post<{ success: boolean }>('/config/llm', data),

    testLlm: () => post<{ ok: boolean; message: string }>('/llm/test'),
  }
}
