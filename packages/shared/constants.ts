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
  { code: 'ctbc', name: '中國信託', emailSender: 'ctbcbank.com', emailSubject: '電子對帳單', passwordHint: '身分證字號' },
  { code: 'cathay', name: '國泰世華', emailSender: 'cathaybk.com', emailSubject: '帳單', passwordHint: '身分證字號' },
  { code: 'taishin', name: '台新銀行', emailSender: 'taishinbank.com.tw', emailSubject: '電子帳單', passwordHint: '身分證字號' },
  { code: 'fubon', name: '台北富邦', emailSender: 'fubon.com', emailSubject: '帳單', passwordHint: '身分證字號' },
  { code: 'sinopac', name: '永豐銀行', emailSender: 'sinopac.com', emailSubject: '電子綜合對帳單', passwordHint: '身分證字號' },
  { code: 'mega', name: '兆豐銀行', emailSender: 'megabank.com.tw', emailSubject: '電子帳單', passwordHint: '身分證字號' },
  { code: 'first', name: '第一銀行', emailSender: 'firstbank.com.tw', emailSubject: '帳單', passwordHint: '身分證字號' },
  { code: 'ubot', name: '聯邦銀行', emailSender: 'ubot.com.tw', emailSubject: '帳單', passwordHint: '身分證字號' },
  { code: 'hua_nan', name: '華南銀行', emailSender: 'hncb.com.tw', emailSubject: '帳單', passwordHint: '身分證字號' },
  { code: 'citi', name: '花旗銀行', emailSender: 'citibank.com', emailSubject: '帳單', passwordHint: '生日（MMDD）' },
]
