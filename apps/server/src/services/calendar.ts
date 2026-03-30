import { google } from 'googleapis'
import type { Bill, Bank } from '../../generated/prisma/client.js'
import { getSetting, setSetting, KEYS } from './settings.js'

async function getAuth() {
  const clientId = await getSetting(KEYS.GOOGLE_CLIENT_ID)
  const clientSecret = await getSetting(KEYS.GOOGLE_CLIENT_SECRET)
  const refreshToken = await getSetting(KEYS.GOOGLE_REFRESH_TOKEN)

  if (!clientId || !clientSecret || !refreshToken) return null

  const auth = new google.auth.OAuth2(clientId, clientSecret)
  auth.setCredentials({ refresh_token: refreshToken })

  auth.on('tokens', async (tokens) => {
    if (tokens.refresh_token) {
      await setSetting(KEYS.GOOGLE_REFRESH_TOKEN, tokens.refresh_token)
    }
  })

  return auth
}

async function getCalendarId(): Promise<string> {
  return (await getSetting(KEYS.GOOGLE_CALENDAR_ID)) || 'primary'
}

function formatAmount(amount: number): string {
  return `NT$ ${amount.toLocaleString('zh-TW')}`
}

export async function createDueDateEvent(bill: Bill, bank: Bank): Promise<string | null> {
  const auth = await getAuth()
  if (!auth) return null

  const calendar = google.calendar({ version: 'v3', auth })
  const calendarId = await getCalendarId()
  const dateStr = bill.dueDate.toISOString().split('T')[0]

  const event = await calendar.events.insert({
    calendarId,
    requestBody: {
      summary: `💳 ${bank.name} 帳單 ${formatAmount(bill.amount)} 截止`,
      description: [
        `銀行：${bank.name}`,
        `應繳金額：${formatAmount(bill.amount)}`,
        bill.minimumPayment ? `最低應繳：${formatAmount(bill.minimumPayment)}` : '',
        `帳單月份：${bill.billingPeriod}`,
      ].filter(Boolean).join('\n'),
      start: { date: dateStr },
      end: { date: dateStr },
      reminders: {
        useDefault: false,
        overrides: [
          { method: 'popup', minutes: 1440 },
          { method: 'popup', minutes: 60 },
        ],
      },
    },
  })

  return event.data.id ?? null
}

export async function deleteDueDateEvent(eventId: string): Promise<void> {
  const auth = await getAuth()
  if (!auth) return

  const calendar = google.calendar({ version: 'v3', auth })
  const calendarId = await getCalendarId()
  try {
    await calendar.events.delete({ calendarId, eventId })
  } catch (e) {
    console.warn(`[calendar] Failed to delete event ${eventId}: ${(e as Error).message}`)
  }
}

export async function updateDueDateEvent(eventId: string, bill: Bill, bank: Bank): Promise<void> {
  const auth = await getAuth()
  if (!auth) return

  const calendar = google.calendar({ version: 'v3', auth })
  const calendarId = await getCalendarId()
  const dateStr = bill.dueDate.toISOString().split('T')[0]

  try {
    await calendar.events.update({
      calendarId,
      eventId,
      requestBody: {
        summary: `💳 ${bank.name} 帳單 ${formatAmount(bill.amount)} 截止`,
        start: { date: dateStr },
        end: { date: dateStr },
      },
    })
  } catch (e) {
    console.warn(`[calendar] Failed to update event ${eventId}: ${(e as Error).message}`)
  }
}

export async function isConfigured(): Promise<boolean> {
  return (await getAuth()) !== null
}
