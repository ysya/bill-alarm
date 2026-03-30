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
  { code: 'yuanta', name: '元大銀行', emailSender: 'YuantaBank@estmt.com.tw', emailSubject: '信用卡電子帳單', passwordHint: '身分證字號' },
  { code: 'ctbc', name: '中國信託', emailSender: 'ebill@estats.ctbcbank.com', emailSubject: '中國信託信用卡電子帳單', passwordHint: '身分證字號' },
  { code: 'taishin', name: '台新銀行', emailSender: 'webmaster@bhurecv.taishinbank.com.tw', emailSubject: '台新信用卡電子帳單', passwordHint: '身分證字號後2碼+生日月日4碼' },
]
