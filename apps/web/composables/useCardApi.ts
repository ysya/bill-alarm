export function useCardApi() {
  const { get, post, patch, del } = useApi()

  return {
    // Get built-in bank presets
    getPresets: () => get<Array<{
      code: string
      name: string
      emailSender: string
      emailSubject: string
      passwordHint: string
    }>>('/cards/presets'),

    // Get user's enabled banks
    list: () => get<any[]>('/cards'),

    // Enable a preset bank
    enable: (code: string, pdfPassword?: string) =>
      post<any>(`/cards/enable/${code}`, pdfPassword ? { pdfPassword } : {}),

    // Disable a bank
    disable: (code: string) => post<any>(`/cards/disable/${code}`),

    // Update bank settings
    update: (id: string, data: Record<string, unknown>) => patch<any>(`/cards/${id}`, data),

    // Add custom bank
    create: (data: {
      bankName: string
      emailSenderPattern: string
      emailSubjectPattern: string
      pdfPassword?: string
    }) => post<any>('/cards', data),

    // Delete custom bank
    remove: (id: string) => del<any>(`/cards/${id}`),
  }
}
