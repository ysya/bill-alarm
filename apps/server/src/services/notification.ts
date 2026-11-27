import prisma from '@/prisma.js'
import { logger } from '@/index.js'
import { sendNewBillAlert, sendBillReminder, sendOverdueWarning, sendDebitConfirmationReminder } from './telegram.js'
import { getEffectivePrefs, POST_DUE_NOTIFY_HOUR } from './notification-prefs.js'
import type { Bill, Bank } from '../../generated/prisma/client.js'
import { BillStatus, isAwaitingDebit } from '@bill-alarm/shared/types'
import { todayYMD, addDaysYMD } from '@bill-alarm/shared/date'

async function logNotification(
  billId: string,
  channel: string,
  message: string,
  success: boolean,
  errorMessage?: string,
) {
  await prisma.notificationLog.create({
    data: { billId, channel, message, success, errorMessage },
  })
}

export async function processNewBill(bill: Bill, bank: Bank, warning?: string): Promise<void> {
  logger.info({ bank: bank.name, amount: bill.amount }, 'Processing new bill notifications')

  if (bill.status === BillStatus.NO_PAYMENT) {
    logger.info({ bank: bank.name, amount: bill.amount }, 'Bill has no payment required — skipping notifications')
    return
  }

  if (bank.autoDebit) {
    logger.info({ bank: bank.name }, 'Auto-debit bank — skipping new bill notifications')
    return
  }

  // Owner deactivated between scan start and now: skip (matches reminder/overdue processors)
  const owner = await prisma.user.findUnique({ where: { id: bank.userId }, select: { deletedAt: true } })
  if (owner?.deletedAt) {
    logger.info({ bank: bank.name }, 'Owner deactivated — skipping new bill notification')
    return
  }

  const prefs = await getEffectivePrefs(bank.userId)
  if (!prefs.notifyNewBill) {
    logger.info({ bank: bank.name }, 'Owner disabled new-bill notifications — skipping')
    return
  }

  const r = await sendNewBillAlert(bill, bank, warning)
  await logNotification(bill.id, 'telegram', '新帳單通知', r.ok, r.error)
  logger.info({ bank: bank.name, ok: r.ok }, 'Telegram notification sent')
}

/** Runs on a 15-minute tick. A user's reminders fire once per day per D-value,
 *  at the first tick at/after their remindTime — so a missed tick (deploy,
 *  downtime) self-heals on the next one, and bills scanned in after the hour
 *  still remind today. Per-user prefs replace the old named rules; an absent
 *  prefs row means the shared defaults. */
export async function processReminders(now: Date = new Date()): Promise<void> {
  const users = await prisma.user.findMany({ where: { deletedAt: null }, select: { id: true } })
  const today = todayYMD(now)
  const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  const todayStart = new Date(now)
  todayStart.setHours(0, 0, 0, 0)

  for (const user of users) {
    const prefs = await getEffectivePrefs(user.id)
    if (prefs.remindDays.length === 0) continue // reminders switched off
    if (hhmm < prefs.remindTime) continue // not yet time today (string compare works for HH:mm)

    for (const d of prefs.remindDays) {
      const bills = await prisma.bill.findMany({
        where: { status: BillStatus.PENDING, bank: { userId: user.id }, dueDate: addDaysYMD(today, d) },
        include: { bank: true },
      })

      for (const bill of bills) {
        if (isAwaitingDebit(bill) || (bill.bank.autoDebit && !bill.transferredAt)) continue

        // A bill matches exactly one D-value per day, so billId+day+message
        // is a sufficient dedup key.
        const message = `到期提醒 D-${d}`
        const alreadySent = await prisma.notificationLog.findFirst({
          where: { billId: bill.id, message, sentAt: { gte: todayStart }, success: true },
        })
        if (alreadySent) continue

        try {
          const r = await sendBillReminder(bill, bill.bank)
          await logNotification(bill.id, 'telegram', message, r.ok, r.error)
        } catch (e) {
          await logNotification(bill.id, 'telegram', message, false, (e as Error).message)
        }
      }
    }
  }
}

export const OVERDUE_WARNING_MESSAGE = '逾期警告'
export const DEBIT_CONFIRMATION_MESSAGE = '扣款確認提醒'

/** Runs on the same 15-minute tick as processReminders. Marking and warning
 *  are split: status is kept accurate within 15 minutes of midnight, while
 *  the (louder) Telegram warning fires exactly once per bill, at the first
 *  tick at/after 09:00 — self-healing the same way reminders do. Reminder
 *  messages are fixed-format ('到期提醒 D-N'), so matching on the warning
 *  message alone is unambiguous. */
export async function processOverdueBills(now: Date = new Date()): Promise<void> {
  const today = todayYMD(now)

  // Mark on every tick so the dashboard is accurate within 15 minutes of midnight.
  const marked = await prisma.bill.updateMany({
    where: { status: BillStatus.PENDING, dueDate: { lt: today } },
    data: { status: BillStatus.OVERDUE },
  })
  if (marked.count > 0) logger.warn({ count: marked.count }, 'Bills marked overdue')

  if (now.getHours() < POST_DUE_NOTIFY_HOUR) return

  const bills = await prisma.bill.findMany({
    where: {
      status: BillStatus.OVERDUE,
      dueDate: { lt: today },
      bank: { user: { deletedAt: null } },
    },
    include: {
      bank: true,
      notifications: {
        where: { channel: 'telegram', success: true, message: { in: [OVERDUE_WARNING_MESSAGE, DEBIT_CONFIRMATION_MESSAGE] } },
        select: { message: true },
      },
    },
  })

  for (const bill of bills) {
    const awaitingDebit = isAwaitingDebit(bill)
    const message = awaitingDebit ? DEBIT_CONFIRMATION_MESSAGE : OVERDUE_WARNING_MESSAGE
    if (bill.notifications.some(log => log.message === message)) continue

    const prefs = await getEffectivePrefs(bill.bank.userId)
    const enabled = awaitingDebit ? prefs.notifyDebitConfirmation : prefs.notifyOverdue
    if (!enabled) continue

    const send = awaitingDebit ? sendDebitConfirmationReminder : sendOverdueWarning
    const r = await send(bill, bill.bank)
    // The same preference enables ICS alarms for users without a Telegram target.
    if (awaitingDebit && r.unavailable) continue
    await logNotification(bill.id, 'telegram', message, r.ok, r.error)
  }
}
