import prisma from '@/prisma.js'
import { logger } from '@/index.js'
import { sendNewBillAlert, sendBillReminder, sendOverdueWarning } from './telegram.js'
import { createDueDateEvent, deleteDueDateEvent } from './calendar.js'
import { getSetting, KEYS } from './settings.js'
import type { Bill, Bank } from '../../generated/prisma/client.js'
import { BillStatus } from '@bill-alarm/shared/types'

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

  if (bank.autoDebit) {
    logger.info({ bank: bank.name }, 'Auto-debit bank — skipping new bill notifications')
    return
  }

  const telegramOk = await sendNewBillAlert(bill, bank)
  await logNotification(bill.id, null, 'telegram', '新帳單通知', telegramOk)
  logger.info({ bank: bank.name, telegramOk }, 'Telegram notification sent')

  const calendarEnabled = await getSetting(KEYS.CALENDAR_ENABLED)
  if (calendarEnabled !== 'true') {
    logger.info({ bank: bank.name }, 'Calendar disabled by user — skipping event creation')
    return
  }

  try {
    if (bill.calendarEventId) {
      logger.info({ bank: bank.name, eventId: bill.calendarEventId }, 'Calendar event already exists, skipping')
    }
    const eventId = !bill.calendarEventId ? await createDueDateEvent(bill, bank) : null
    if (eventId) {
      await prisma.bill.update({
        where: { id: bill.id },
        data: { calendarEventId: eventId },
      })
      await logNotification(bill.id, null, 'calendar', '建立行事曆事件', true)
      logger.info({ bank: bank.name, eventId }, 'Calendar event created')
    }
  } catch (e) {
    await logNotification(bill.id, null, 'calendar', '建立行事曆事件', false, (e as Error).message)
    logger.error({ bank: bank.name, error: (e as Error).message }, 'Calendar event creation failed')
  }
}

export async function processReminderRules(): Promise<void> {
  const rules = await prisma.notificationRule.findMany({ where: { isActive: true } })
  logger.info({ ruleCount: rules.length }, 'Processing reminder rules')
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  for (const rule of rules) {
    const targetDate = new Date(today)
    targetDate.setDate(targetDate.getDate() + rule.daysBefore)

    const bills = await prisma.bill.findMany({
      where: {
        status: BillStatus.PENDING,
        dueDate: {
          gte: targetDate,
          lt: new Date(targetDate.getTime() + 24 * 60 * 60 * 1000),
        },
      },
      include: { bank: true },
    })

    const channels: string[] = JSON.parse(rule.channels)

    for (const bill of bills) {
      if (bill.bank.autoDebit) continue

      const todayStart = new Date(today)
      const todayEnd = new Date(today)
      todayEnd.setDate(todayEnd.getDate() + 1)

      const alreadySent = await prisma.notificationLog.findFirst({
        where: {
          billId: bill.id,
          ruleId: rule.id,
          sentAt: { gte: todayStart, lt: todayEnd },
          success: true,
        },
      })
      if (alreadySent) continue

      for (const channel of channels) {
        let success = false
        try {
          if (channel === 'telegram') {
            success = await sendBillReminder(bill, bill.bank)
          }
        } catch (e) {
          await logNotification(bill.id, rule.id, channel, rule.name, false, (e as Error).message)
          continue
        }
        await logNotification(bill.id, rule.id, channel, rule.name, success)
      }
    }
  }
}

export async function processOverdueBills(): Promise<void> {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const overdueBills = await prisma.bill.findMany({
    where: {
      status: BillStatus.PENDING,
      dueDate: { lt: today },
    },
    include: { bank: true },
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

    const success = await sendOverdueWarning(bill, bill.bank)
    await logNotification(bill.id, null, 'telegram', '逾期警告', success)
  }
}

export async function handleBillPaid(billId: string): Promise<void> {
  const bill = await prisma.bill.findUnique({ where: { id: billId } })
  if (!bill) return

  if (bill.calendarEventId) {
    await deleteDueDateEvent(bill.calendarEventId)
    await prisma.bill.update({
      where: { id: billId },
      data: { calendarEventId: null },
    })
  }
}
