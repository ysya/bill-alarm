import prisma from '@/prisma.js'
import { logger } from '@/index.js'
import { sendNewBillAlert, sendBillReminder, sendOverdueWarning } from './telegram.js'
import type { Bill, Bank } from '../../generated/prisma/client.js'
import { BillStatus } from '@bill-alarm/shared/types'
import { todayYMD, addDaysYMD } from '@bill-alarm/shared/date'

async function logNotification(
  billId: string,
  ruleId: string | null,
  channel: string,
  message: string,
  success: boolean,
  errorMessage?: string,
) {
  await prisma.notificationLog.create({
    data: { billId, ruleId, channel, message, success, errorMessage },
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

  const r = await sendNewBillAlert(bill, bank, warning)
  await logNotification(bill.id, null, 'telegram', '新帳單通知', r.ok, r.error)
  logger.info({ bank: bank.name, ok: r.ok }, 'Telegram notification sent')
}

/** Runs on a 15-minute tick. A rule fires once per day, at the first tick
 *  at/after its timeOfDay — so a missed tick (deploy, downtime) self-heals
 *  on the next one, and bills scanned in after the hour still remind today. */
export async function processReminderRules(now: Date = new Date()): Promise<void> {
  const rules = await prisma.notificationRule.findMany({
    where: { isActive: true, user: { deletedAt: null } },
  })
  logger.debug({ ruleCount: rules.length }, 'Processing reminder rules')
  const today = todayYMD(now)
  const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  const todayStart = new Date(now)
  todayStart.setHours(0, 0, 0, 0)

  for (const rule of rules) {
    if (hhmm < rule.timeOfDay) continue // not yet time today (string compare works for HH:mm)

    const bills = await prisma.bill.findMany({
      where: {
        status: BillStatus.PENDING,
        bank: { userId: rule.userId },
        dueDate: addDaysYMD(today, rule.daysBefore),
      },
      include: { bank: true },
    })

    const channels: string[] = JSON.parse(rule.channels)

    for (const bill of bills) {
      if (bill.bank.autoDebit) continue

      const alreadySent = await prisma.notificationLog.findFirst({
        where: { billId: bill.id, ruleId: rule.id, sentAt: { gte: todayStart }, success: true },
      })
      if (alreadySent) continue

      for (const channel of channels) {
        try {
          if (channel === 'telegram') {
            const r = await sendBillReminder(bill, bill.bank)
            await logNotification(bill.id, rule.id, channel, rule.name, r.ok, r.error)
          }
        } catch (e) {
          await logNotification(bill.id, rule.id, channel, rule.name, false, (e as Error).message)
        }
      }
    }
  }
}

export const OVERDUE_WARNING_MESSAGE = '逾期警告'
const OVERDUE_NOTIFY_HOUR = 9 // don't page people at midnight

/** Runs on the same 15-minute tick as processReminderRules. Marking and
 *  warning are split: status is kept accurate within 15 minutes of midnight,
 *  while the (louder) Telegram warning fires exactly once per bill, at the
 *  first tick at/after 09:00 — self-healing the same way reminders do. */
export async function processOverdueBills(now: Date = new Date()): Promise<void> {
  const today = todayYMD(now)

  // Mark on every tick so the dashboard is accurate within 15 minutes of midnight.
  const marked = await prisma.bill.updateMany({
    where: { status: BillStatus.PENDING, dueDate: { lt: today } },
    data: { status: BillStatus.OVERDUE },
  })
  if (marked.count > 0) logger.warn({ count: marked.count }, 'Bills marked overdue')

  if (now.getHours() < OVERDUE_NOTIFY_HOUR) return

  // Warn exactly once per bill, at the first tick at/after 09:00.
  const unnotified = await prisma.bill.findMany({
    where: {
      status: BillStatus.OVERDUE,
      notifications: { none: { message: OVERDUE_WARNING_MESSAGE, success: true } },
    },
    include: { bank: { include: { user: { select: { deletedAt: true } } } } },
  })

  for (const bill of unnotified) {
    if (bill.bank.user?.deletedAt) continue // deactivated owner: status is fact, noise is not
    const r = await sendOverdueWarning(bill, bill.bank)
    await logNotification(bill.id, null, 'telegram', OVERDUE_WARNING_MESSAGE, r.ok, r.error)
  }
}

