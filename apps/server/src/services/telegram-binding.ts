import { randomBytes } from 'node:crypto'
import prisma from '@/prisma.js'
import { getUpdates } from './telegram.js'

const CODE_TTL_MS = 10 * 60 * 1000

interface PendingBind {
  code: string
  expiresAt: number
}

// One outstanding code per user; in-memory is fine (single process, short TTL).
const pending = new Map<string, PendingBind>()

/** test-only */
export function _resetBindCodes(): void {
  pending.clear()
}

export function createBindCode(userId: string): { code: string; expiresAt: Date } {
  for (const [uid, entry] of pending) {
    if (entry.expiresAt < Date.now()) pending.delete(uid)
  }
  const code = randomBytes(8).toString('hex') // 16 hex chars — valid t.me start payload
  const expiresAt = Date.now() + CODE_TTL_MS
  pending.set(userId, { code, expiresAt })
  return { code, expiresAt: new Date(expiresAt) }
}

export type ConfirmResult =
  | { status: 'ok'; chatId: string }
  | { status: 'no_code' }
  | { status: 'not_seen' }

export async function confirmBind(userId: string): Promise<ConfirmResult> {
  const entry = pending.get(userId)
  if (!entry || entry.expiresAt < Date.now()) {
    pending.delete(userId)
    return { status: 'no_code' }
  }
  const updates = await getUpdates()
  const match = [...updates].reverse().find(u => u.message?.text === `/start ${entry.code}`)
  if (!match?.message) return { status: 'not_seen' }
  const chatId = String(match.message.chat.id)
  await prisma.user.update({ where: { id: userId }, data: { telegramChatId: chatId } })
  pending.delete(userId)
  return { status: 'ok', chatId }
}
