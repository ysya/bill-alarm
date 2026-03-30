export function useBankApi() {
  const { get, post, patch, del } = useApi()

  return {
    getPresets: () => get<Array<{
      code: string
      name: string
      emailSender: string
      emailSubject: string
      passwordHint: string
    }>>('/banks/presets'),

    list: () => get<any[]>('/banks'),

    enable: (code: string, pdfPassword?: string) =>
      post<any>(`/banks/enable/${code}`, pdfPassword ? { pdfPassword } : {}),

    disable: (code: string) => post<any>(`/banks/disable/${code}`),

    update: (id: string, data: Record<string, unknown>) => patch<any>(`/banks/${id}`, data),

    create: (data: {
      name: string
      emailSenderPattern: string
      emailSubjectPattern: string
      pdfPassword?: string
    }) => post<any>('/banks', data),

    remove: (id: string) => del<any>(`/banks/${id}`),
  }
}
