import type { Bill, Bank } from '../../generated/prisma/client.js'
import prisma from '@/prisma.js'
import { getSetting, KEYS } from './settings.js'

const API_BASE = 'https://api.telegram.org/bot'

async function getBotToken(): Promise<string | null> {
  return getSetting(KEYS.TELEGRAM_BOT_TOKEN)
}

async function sendRaw(token: string, chatId: string, text: string): Promise<{ ok: boolean; error?: string }> {
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
}

export async function sendMessage(chatId: string, text: string): Promise<boolean> {
  const token = await getBotToken()
  if (!token) {
    console.warn('[telegram] Bot token not configured, skipping message')
    return false
  }
  return (await sendRaw(token, chatId, text)).ok
}

export interface BroadcastResult {
  ok: boolean
  sent: number
  failed: number
  errors: string[]
}

/** Send to every bound user, deduplicating chat ids (two users in one group chat → one message). */
export async function broadcast(text: string): Promise<BroadcastResult> {
  const token = await getBotToken()
  if (!token) {
    console.warn('[telegram] Bot token not configured, skipping message')
    return { ok: false, sent: 0, failed: 0, errors: ['bot token not configured'] }
  }
  const users = await prisma.user.findMany({
    where: { telegramChatId: { not: null } },
    select: { telegramChatId: true },
  })
  const chatIds = [...new Set(users.map(u => u.telegramChatId!))]
  if (chatIds.length === 0) {
    console.warn('[telegram] No bound users, skipping message')
    return { ok: false, sent: 0, failed: 0, errors: ['no bound users'] }
  }
  const result: BroadcastResult = { ok: false, sent: 0, failed: 0, errors: [] }
  for (const chatId of chatIds) {
    const r = await sendRaw(token, chatId, text)
    if (r.ok) result.sent += 1
    else {
      result.failed += 1
      result.errors.push(`chat ${chatId}: ${r.error}`)
    }
  }
  result.ok = result.sent > 0
  return result
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
  const res = await fetch(`${API_BASE}${token}/getMe`)
  if (!res.ok) return null
  const body = await res.json() as { ok: boolean; result?: { username?: string } }
  cachedBotUsername = body.ok ? body.result?.username ?? null : null
  return cachedBotUsername
}

export interface TgUpdate {
  update_id: number
  message?: { text?: string; chat: { id: number } }
}

/** No offset commit: family-scale volume, Telegram expires updates after 24h. */
export async function getUpdates(): Promise<TgUpdate[]> {
  const token = await getBotToken()
  if (!token) return []
  const res = await fetch(`${API_BASE}${token}/getUpdates`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ timeout: 0, allowed_updates: ['message'] }),
  })
  if (!res.ok) return []
  const body = await res.json() as { ok: boolean; result?: TgUpdate[] }
  return body.ok ? body.result ?? [] : []
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

export async function sendNewBillAlert(bill: Bill, bank: Bank): Promise<BroadcastResult> {
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

  return broadcast(lines.join('\n'))
}

export async function sendBillReminder(bill: Bill, bank: Bank): Promise<BroadcastResult> {
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

  return broadcast(text)
}

export async function sendOverdueWarning(bill: Bill, bank: Bank): Promise<BroadcastResult> {
  const text = [
    '<b>🔴 帳單逾期警告</b>',
    '',
    `🏦 ${bank.name}`,
    `💰 應繳金額：${formatAmount(bill.amount)}`,
    `📅 截止日：${formatDate(bill.dueDate)}（已逾期）`,
    '',
    '⚠️ 請儘速繳款以避免延遲利息！',
  ].join('\n')

  return broadcast(text)
}

export async function sendTestMessage(chatId: string): Promise<boolean> {
  return sendMessage(chatId, '🔔 Bill Alarm 測試訊息\n\n連線成功！通知功能正常運作。')
}

export async function isConfigured(): Promise<boolean> {
  return !!(await getBotToken())
}
