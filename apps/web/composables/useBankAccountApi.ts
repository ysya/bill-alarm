import type { BankAccountDTO } from '@bill-alarm/shared/types'

export function useBankAccountApi() {
  const { get, post, patch, del } = useApi()

  return {
    list: () => get<BankAccountDTO[]>('/bank-accounts'),
    create: (data: { name: string, bankName: string, note?: string }) => post<BankAccountDTO>('/bank-accounts', data),
    update: (id: string, data: Record<string, unknown>) => patch<BankAccountDTO>(`/bank-accounts/${id}`, data),
    remove: (id: string) => del<{ success: boolean }>(`/bank-accounts/${id}`),
  }
}
