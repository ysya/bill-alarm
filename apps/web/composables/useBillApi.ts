export function useBillApi() {
  const { get, patch, del } = useApi()

  return {
    getSummary: () => get<{
      totalPending: number
      pendingCount: number
      paidCount: number
      overdueCount: number
      nextDueDate: string | null
    }>('/bills/summary'),

    list: (params?: { status?: string; month?: string; bankId?: string }) => {
      const query = new URLSearchParams()
      if (params?.status) query.set('status', params.status)
      if (params?.month) query.set('month', params.month)
      if (params?.bankId) query.set('bankId', params.bankId)
      const qs = query.toString()
      return get<any[]>(`/bills${qs ? `?${qs}` : ''}`)
    },

    getById: (id: string) => get<any>(`/bills/${id}`),

    update: (id: string, data: Record<string, unknown>) => patch<any>(`/bills/${id}`, data),

    markAsPaid: (id: string) => patch<any>(`/bills/${id}/pay`),

    remove: (id: string) => del<any>(`/bills/${id}`),
  }
}
