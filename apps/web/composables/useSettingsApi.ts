import type { ConfigStatus, EmailStatus } from '~/types/settings'
import type { ScanError, ScanErrorStage, ScanLogDTO } from '@bill-alarm/shared/scan'
import type { NotificationRuleDTO } from '@bill-alarm/shared/types'

export type { ScanError, ScanErrorStage, ScanLogDTO }

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
    listRules: () => get<NotificationRuleDTO[]>('/notification-rules'),
    createRule: (data: {
      name: string
      daysBefore: number
      timeOfDay: string
      channels: string[]
      isActive?: boolean
    }) => post<NotificationRuleDTO>('/notification-rules', data),
    updateRule: (id: string, data: Record<string, unknown>) =>
      patch<NotificationRuleDTO>(`/notification-rules/${id}`, data),
    deleteRule: (id: string) => del<{ success: boolean }>(`/notification-rules/${id}`),

    // Email scan
    triggerScan: () => post<{ scanLogId?: string, scanned: number, newBills: number, errors: ScanError[] }>('/email/scan'),

    listScanLogs: (limit = 20) =>
      get<{ logs: ScanLogDTO[] }>(`/scan-logs?limit=${limit}`),

    // Telegram
    testTelegram: () => post<{ success: boolean }>('/telegram/test'),

    // Email (IMAP)
    testEmailConnection: (data: EmailConfigPayload) =>
      post<{ ok: boolean, email?: string, error?: string }>('/email/test', {
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

    // Default is a cheap DB-only read; pass verify=true to also probe the live
    // IMAP connection (adds connected/message/email, costs a real round-trip).
    getEmailStatus: (verify = false) => get<EmailStatus>(`/email/status${verify ? '?verify=1' : ''}`),

    // Calendar (ICS feed)
    getCalendarFeed: () =>
      get<{ token: string, feedUrl: string, feedPath: string }>('/calendar/info'),

    rotateCalendarToken: () =>
      post<{ token: string, feedUrl: string, feedPath: string }>('/calendar/rotate'),

    // Aggregated config status
    getConfigStatus: () => get<ConfigStatus>('/config/status'),

    saveTelegramConfig: (botToken: string) =>
      post<{ success: boolean }>('/config/telegram', { botToken }),

    // Telegram per-user binding
    telegramBind: () => post<{ deepLink: string, expiresAt: string }>('/auth/telegram/bind'),
    telegramConfirm: () => post<{ ok: boolean }>('/auth/telegram/confirm'),
    telegramUnbind: () => del<{ ok: boolean }>('/auth/telegram'),

    saveScanInterval: (interval: number) =>
      post<{ success: boolean }>('/config/scan', { interval }),

    saveScanConfig: (data: { interval?: number, rangeDays?: number, queryExtra?: string }) =>
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

    testLlm: () => post<{ ok: boolean, message: string }>('/llm/test'),
  }
}
