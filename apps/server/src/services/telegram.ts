import type { Bill, Bank } from '../../generated/prisma/client.js'
import { getSetting, KEYS } from './settings.js'

const API_BASE = 'https://api.telegram.org/bot'

async function getConfig() {
  const token = await getSetting(KEYS.TELEGRAM_BOT_TOKEN)
  const chatId = await getSetting(KEYS.TELEGRAM_CHAT_ID)
  if (!token || !chatId) return null
  return { token, chatId }
}

async function sendMessage(text: string): Promise<boolean> {
  const config = await getConfig()
  if (!config) {
    console.warn('[telegram] Not configured, skipping message')
    return false
  }

  const res = await fetch(`${API_BASE}${config.token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: config.chatId,
      text,
      parse_mode: 'HTML',
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    console.error(`[telegram] Send failed: ${err}`)
    return false
  }
  return true
}

function formatAmount(amount: number): string {
  return `NT$ ${amount.toLocaleString('zh-TW')}`
}

function formatDate(date: Date): string {
  return `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`
}

function daysUntil(date: Date): number {
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  const target = new Date(date)
  target.setHours(0, 0, 0, 0)
  return Math.ceil((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
}

export async function sendNewBillAlert(bill: Bill, bank: Bank): Promise<boolean> {
  const days = daysUntil(bill.dueDate)
  const usedLlm = bill.parseSource === 'llm'

  const lines: string[] = [
    usedLlm ? '<b>📨 收到新帳單（AI 解析）</b>' : '<b>📨 收到新帳單</b>',
    '',
    `🏦 ${bank.name}`,
    `💰 應繳金額：${formatAmount(bill.amount)}`,
  ]
  if (bill.minimumPayment) lines.push(`📉 最低應繳：${formatAmount(bill.minimumPayment)}`)
  lines.push(`📅 截止日：${formatDate(bill.dueDate)}`)
  lines.push(`⏰ 還有 ${days} 天`)

  if (usedLlm) {
    const baseUrl = await getSetting(KEYS.APP_BASE_URL)
    if (baseUrl) {
      const link = `${baseUrl.replace(/\/$/, '')}/bills/${bill.id}`
      lines.push('')
      lines.push(`🤖 此次由 AI 解析，<a href="${link}">核對數值</a>。`)
    } else {
      lines.push('')
      lines.push('🤖 此次由 AI 解析，請到帳單詳情頁核對金額。')
    }
  }

  return sendMessage(lines.join('\n'))
}

export async function sendBillReminder(bill: Bill, bank: Bank): Promise<boolean> {
  const days = daysUntil(bill.dueDate)
  const urgency = days <= 1 ? '🔴 緊急' : days <= 3 ? '🟡 注意' : '🔵 提醒'

  const text = [
    `<b>${urgency} 信用卡帳單提醒</b>`,
    '',
    `🏦 ${bank.name}`,
    `💰 應繳金額：${formatAmount(bill.amount)}`,
    `📅 截止日：${formatDate(bill.dueDate)}`,
    days === 0 ? '⚠️ 今天是最後繳費日！' : `⏰ 還有 ${days} 天`,
  ].join('\n')

  return sendMessage(text)
}

export async function sendOverdueWarning(bill: Bill, bank: Bank): Promise<boolean> {
  const text = [
    '<b>🔴 帳單逾期警告</b>',
    '',
    `🏦 ${bank.name}`,
    `💰 應繳金額：${formatAmount(bill.amount)}`,
    `📅 截止日：${formatDate(bill.dueDate)}（已逾期）`,
    '',
    '⚠️ 請儘速繳款以避免延遲利息！',
  ].join('\n')

  return sendMessage(text)
}

export async function sendTestMessage(): Promise<boolean> {
  return sendMessage('🔔 Bill Alarm 測試訊息\n\n連線成功！通知功能正常運作。')
}

export async function isConfigured(): Promise<boolean> {
  return (await getConfig()) !== null
}
