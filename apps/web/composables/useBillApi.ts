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

    list: (params?: { status?: string; bankId?: string; page?: number; pageSize?: number }) => {
      const query = new URLSearchParams()
      if (params?.status) query.set('status', params.status)
      if (params?.bankId) query.set('bankId', params.bankId)
      if (params?.page) query.set('page', String(params.page))
      if (params?.pageSize) query.set('pageSize', String(params.pageSize))
      const qs = query.toString()
      return get<{ data: any[]; total: number; page: number; pageSize: number }>(`/bills${qs ? `?${qs}` : ''}`)
    },

    getById: (id: string) => get<any>(`/bills/${id}`),

    update: (id: string, data: Record<string, unknown>) => patch<any>(`/bills/${id}`, data),

    markAsPaid: (id: string, paidAt?: string) => patch<any>(`/bills/${id}/pay`, paidAt ? { paidAt } : {}),

    remove: (id: string) => del<any>(`/bills/${id}`),
  }
}
