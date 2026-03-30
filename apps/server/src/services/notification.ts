import prisma from '../db/prisma.js'
import { sendNewBillAlert, sendBillReminder, sendOverdueWarning } from './telegram.js'
import { createDueDateEvent, deleteDueDateEvent } from './calendar.js'
import type { Bill, CreditCard } from '../../generated/prisma/client.js'

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

export async function processNewBill(bill: Bill, card: CreditCard): Promise<void> {
  // Send Telegram alert
  const telegramOk = await sendNewBillAlert(bill, card)
  await logNotification(bill.id, null, 'telegram', '新帳單通知', telegramOk)

  // Create Calendar event
  try {
    const eventId = await createDueDateEvent(bill, card)
    if (eventId) {
      await prisma.bill.update({
        where: { id: bill.id },
        data: { calendarEventId: eventId },
      })
      await logNotification(bill.id, null, 'calendar', '建立行事曆事件', true)
    }
  } catch (e) {
    await logNotification(bill.id, null, 'calendar', '建立行事曆事件', false, (e as Error).message)
  }
}

export async function processReminderRules(): Promise<void> {
  const rules = await prisma.notificationRule.findMany({ where: { isActive: true } })
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  for (const rule of rules) {
    const targetDate = new Date(today)
    targetDate.setDate(targetDate.getDate() + rule.daysBefore)

    // Find pending bills with dueDate matching rule's daysBefore
    const bills = await prisma.bill.findMany({
      where: {
        status: 'pending',
        dueDate: {
          gte: targetDate,
          lt: new Date(targetDate.getTime() + 24 * 60 * 60 * 1000),
        },
      },
      include: { creditCard: true },
    })

    const channels: string[] = JSON.parse(rule.channels)

    for (const bill of bills) {
      // Deduplication: check if already sent today for this bill + rule
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
            success = await sendBillReminder(bill, bill.creditCard)
          }
          // calendar event already created when bill was detected
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
      status: 'pending',
      dueDate: { lt: today },
    },
    include: { creditCard: true },
  })

  for (const bill of overdueBills) {
    await prisma.bill.update({
      where: { id: bill.id },
      data: { status: 'overdue' },
    })

    const success = await sendOverdueWarning(bill, bill.creditCard)
    await logNotification(bill.id, null, 'telegram', '逾期警告', success)
  }
}

export async function handleBillPaid(billId: string): Promise<void> {
  const bill = await prisma.bill.findUnique({ where: { id: billId } })
  if (!bill) return

  // Remove calendar event if exists
  if (bill.calendarEventId) {
    await deleteDueDateEvent(bill.calendarEventId)
    await prisma.bill.update({
      where: { id: billId },
      data: { calendarEventId: null },
    })
  }
}
