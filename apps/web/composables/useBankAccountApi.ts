export function useBankAccountApi() {
  const { get, post, patch, del } = useApi()

  return {
    list: () => get<any[]>('/bank-accounts'),
    create: (data: { name: string; bankName: string; note?: string }) => post<any>('/bank-accounts', data),
    update: (id: string, data: Record<string, unknown>) => patch<any>(`/bank-accounts/${id}`, data),
    remove: (id: string) => del<any>(`/bank-accounts/${id}`),
  }
}
