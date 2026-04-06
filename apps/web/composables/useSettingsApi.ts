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
    triggerScan: () => post<{ scanned: number; newBills: number; errors: string[] }>('/gmail/scan'),

    // Telegram
    testTelegram: () => post<{ success: boolean }>('/telegram/test'),

    // OAuth / Config
    getOAuthStatus: () => get<{
      google: { hasCredentials: boolean; isConnected: boolean; clientId: string | null }
      telegram: { isConfigured: boolean; chatId: string | null }
      calendar: { calendarId: string; enabled: boolean }
      gemini: { isConfigured: boolean }
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

    saveGeminiConfig: (apiKey: string) =>
      post<{ success: boolean }>('/oauth/gemini/config', { apiKey }),
  }
}
