import type { Bill, Bank } from '../../generated/prisma/client.js'
import prisma from '@/prisma.js'
import { getSetting, KEYS } from './settings.js'
import { formatAmount } from '@bill-alarm/shared/format'
import { daysUntil, formatYMD } from '@bill-alarm/shared/date'

const API_BASE = 'https://api.telegram.org/bot'

async function getBotToken(): Promise<string | null> {
  return getSetting(KEYS.TELEGRAM_BOT_TOKEN)
}

async function sendRaw(token: string, chatId: string, text: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${API_BASE}${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
    })
    if (!res.ok) {
      const err = await res.text()
      console.error(`[telegram] Send to ${chatId} failed: ${err}`)
      return { ok: false, error: err }
    }
    return { ok: true }
  } catch (e) {
    const err = (e as Error).message ?? String(e)
    console.error(`[telegram] Send to ${chatId} threw: ${err}`)
    return { ok: false, error: err }
  }
}

export async function sendMessage(chatId: string, text: string): Promise<boolean> {
  const token = await getBotToken()
  if (!token) {
    console.warn('[telegram] Bot token not configured, skipping message')
    return false
  }
  return (await sendRaw(token, chatId, text)).ok
}

export interface SendOutcome {
  ok: boolean
  error?: string
}

/** Send to one user's bound chat. Unbound users fail gracefully — callers log, never throw. */
export async function sendToUser(userId: string, text: string): Promise<SendOutcome> {
  const token = await getBotToken()
  if (!token) {
    console.warn('[telegram] Bot token not configured, skipping message')
    return { ok: false, error: 'bot token not configured' }
  }
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { telegramChatId: true } })
  if (!user?.telegramChatId) {
    return { ok: false, error: '使用者未綁定 Telegram' }
  }
  return sendRaw(token, user.telegramChatId, text)
}

// --- Bot identity & updates (binding flow) ---

let cachedBotUsername: string | null = null

/** test-only */
export function _resetTelegramCaches(): void {
  cachedBotUsername = null
}

export async function getBotUsername(): Promise<string | null> {
  if (cachedBotUsername) return cachedBotUsername
  const token = await getBotToken()
  if (!token) return null
  try {
    const res = await fetch(`${API_BASE}${token}/getMe`)
    if (!res.ok) return null
    const body = await res.json() as { ok: boolean; result?: { username?: string } }
    cachedBotUsername = body.ok ? body.result?.username ?? null : null
    return cachedBotUsername
  } catch {
    return null
  }
}

export interface TgUpdate {
  update_id: number
  message?: { text?: string; chat: { id: number } }
}

/** No offset commit: family-scale volume, Telegram expires updates after 24h. */
export async function getUpdates(): Promise<TgUpdate[]> {
  const token = await getBotToken()
  if (!token) return []
  try {
    const res = await fetch(`${API_BASE}${token}/getUpdates`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ timeout: 0, allowed_updates: ['message'] }),
    })
    if (!res.ok) return []
    const body = await res.json() as { ok: boolean; result?: TgUpdate[] }
    return body.ok ? body.result ?? [] : []
  } catch {
    return []
  }
}

export async function sendNewBillAlert(bill: Bill, bank: Bank, warning?: string): Promise<SendOutcome> {
  const days = daysUntil(bill.dueDate)
  const usedLlm = bill.parseSource === 'llm'

  const lines: string[] = [
    usedLlm ? '<b>📨 收到新帳單（AI 解析）</b>' : '<b>📨 收到新帳單</b>',
    '',
    `🏦 ${bank.name}`,
    `💰 應繳金額：${formatAmount(bill.amount)}`,
  ]
  if (bill.minimumPayment) lines.push(`📉 最低應繳：${formatAmount(bill.minimumPayment)}`)
  lines.push(`📅 截止日：${formatYMD(bill.dueDate)}`)
  lines.push(`⏰ 還有 ${days} 天`)

  if (warning) {
    lines.push('')
    lines.push(`⚠️ 解析結果異常（${warning}），請核對後再繳費。`)
  }

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

  return sendToUser(bank.userId, lines.join('\n'))
}

export async function sendBillReminder(bill: Bill, bank: Bank): Promise<SendOutcome> {
  const days = daysUntil(bill.dueDate)
  const urgency = days <= 1 ? '🔴 緊急' : days <= 3 ? '🟡 注意' : '🔵 提醒'

  const text = [
    `<b>${urgency} 信用卡帳單提醒</b>`,
    '',
    `🏦 ${bank.name}`,
    `💰 應繳金額：${formatAmount(bill.amount)}`,
    `📅 截止日：${formatYMD(bill.dueDate)}`,
    days === 0 ? '⚠️ 今天是最後繳費日！' : `⏰ 還有 ${days} 天`,
  ].join('\n')

  return sendToUser(bank.userId, text)
}

export async function sendOverdueWarning(bill: Bill, bank: Bank): Promise<SendOutcome> {
  const text = [
    '<b>🔴 帳單逾期警告</b>',
    '',
    `🏦 ${bank.name}`,
    `💰 應繳金額：${formatAmount(bill.amount)}`,
    `📅 截止日：${formatYMD(bill.dueDate)}（已逾期）`,
    '',
    '⚠️ 請儘速繳款以避免延遲利息！',
  ].join('\n')

  return sendToUser(bank.userId, text)
}

export async function sendTestMessage(chatId: string): Promise<boolean> {
  return sendMessage(chatId, '🔔 Bill Alarm 測試訊息\n\n連線成功！通知功能正常運作。')
}

export async function isConfigured(): Promise<boolean> {
  return !!(await getBotToken())
}
