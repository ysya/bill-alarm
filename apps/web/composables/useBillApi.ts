import type { BillDetailDTO, BillDTO, BillListResponse, MonthlySummaryDTO } from '@bill-alarm/shared/types'

export function useBillApi() {
  const { get, post, patch, del } = useApi()

  return {
    getSummary: (month?: string) => {
      const qs = month ? `?month=${month}` : ''
      // breakdown/timeline are only populated when `month` is passed, but both
      // fields are optional on MonthlySummaryDTO so this type fits either call.
      return get<MonthlySummaryDTO>(`/bills/summary${qs}`)
    },

    list: (params?: { status?: string, bankId?: string, page?: number, pageSize?: number }) => {
      const query = new URLSearchParams()
      if (params?.status) query.set('status', params.status)
      if (params?.bankId) query.set('bankId', params.bankId)
      if (params?.page) query.set('page', String(params.page))
      if (params?.pageSize) query.set('pageSize', String(params.pageSize))
      const qs = query.toString()
      return get<BillListResponse>(`/bills${qs ? `?${qs}` : ''}`)
    },

    getById: (id: string) => get<BillDetailDTO>(`/bills/${id}`),

    // update/markAsPaid/unpay/reparse all resolve to prisma.bill.update() without
    // `include`, so the response has no `bank` key — matches BillDTO's optional bank.
    update: (id: string, data: Record<string, unknown>) => patch<BillDTO>(`/bills/${id}`, data),

    markAsPaid: (id: string, paidAt?: string) => patch<BillDTO>(`/bills/${id}/pay`, paidAt ? { paidAt } : {}),

    unpay: (id: string) => post<BillDTO>(`/bills/${id}/unpay`),

    reparse: (id: string) => post<BillDTO>(`/bills/${id}/reparse`),

    remove: (id: string) => del<{ success: boolean }>(`/bills/${id}`),
  }
}
