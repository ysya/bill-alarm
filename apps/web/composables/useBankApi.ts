import type { BankPreset } from '@bill-alarm/shared/constants'
import type { BankDTO } from '@bill-alarm/shared/types'

export function useBankApi() {
  const { get, post, patch, del } = useApi()

  return {
    getPresets: () => get<BankPreset[]>('/banks/presets'),

    list: () => get<BankDTO[]>('/banks'),

    enable: (code: string, pdfPassword?: string) =>
      post<BankDTO>(`/banks/enable/${code}`, pdfPassword ? { pdfPassword } : {}),

    disable: (code: string) => post<BankDTO>(`/banks/disable/${code}`),

    update: (id: string, data: Record<string, unknown>) => patch<BankDTO>(`/banks/${id}`, data),

    create: (data: {
      name: string
      emailSenderPattern: string
      emailSubjectPattern: string
      pdfPassword?: string
    }) => post<BankDTO>('/banks', data),

    remove: (id: string) => del<{ success: boolean }>(`/banks/${id}`),
  }
}
