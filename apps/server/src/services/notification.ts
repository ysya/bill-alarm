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

export async function processNewBill(bill: Bill, bank: Bank): Promise<void> {
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

  const r = await sendNewBillAlert(bill, bank)
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

export async function processOverdueBills(): Promise<void> {
  const overdueBills = await prisma.bill.findMany({
    where: {
      status: BillStatus.PENDING,
      dueDate: { lt: todayYMD() },
    },
    include: { bank: { include: { user: { select: { deletedAt: true } } } } },
  })

  if (overdueBills.length > 0) {
    logger.warn({ count: overdueBills.length }, 'Found overdue bills')
  }

  for (const bill of overdueBills) {
    await prisma.bill.update({
      where: { id: bill.id },
      data: { status: BillStatus.OVERDUE },
    })
    logger.warn({ bank: bill.bank.name, amount: bill.amount, dueDate: bill.dueDate }, 'Bill marked overdue')

    if (bill.bank.user?.deletedAt) continue // deactivated owner: status is fact, noise is not
    const r = await sendOverdueWarning(bill, bill.bank)
    await logNotification(bill.id, null, 'telegram', '逾期警告', r.ok, r.error)
  }
}

