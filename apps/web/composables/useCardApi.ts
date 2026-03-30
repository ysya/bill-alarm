export function useCardApi() {
  const { get, post, patch, del } = useApi()

  return {
    list: () => get<any[]>('/cards'),

    getById: (id: string) => get<any>(`/cards/${id}`),

    create: (data: {
      bankName: string
      emailSenderPattern: string
      emailSubjectPattern: string
      pdfPassword?: string
    }) => post<any>('/cards', data),

    update: (id: string, data: Record<string, unknown>) => patch<any>(`/cards/${id}`, data),

    remove: (id: string) => del<any>(`/cards/${id}`),
  }
}
