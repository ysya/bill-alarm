export const BILL_STATUS_LABELS: Record<string, string> = {
  pending: '待繳',
  paid: '已繳',
  overdue: '逾期',
}

export const NOTIFICATION_CHANNEL_LABELS: Record<string, string> = {
  telegram: 'Telegram',
  calendar: 'Google Calendar',
}

export const DEFAULT_NOTIFICATION_RULES = [
  { name: '到期前3天提醒', daysBefore: 3, timeOfDay: '09:00', channels: ['telegram'] },
  { name: '到期當天提醒', daysBefore: 0, timeOfDay: '09:00', channels: ['telegram', 'calendar'] },
]

export interface BankPreset {
  code: string
  name: string
  emailSender: string
  emailSubject: string
  passwordHint: string
}

export const BANK_PRESETS: BankPreset[] = [
  { code: 'esun', name: '玉山銀行', emailSender: 'estatement@esunbank.com', emailSubject: '信用卡電子帳單', passwordHint: '無密碼（留空）' },
]
