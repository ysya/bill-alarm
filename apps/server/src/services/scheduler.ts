import cron from 'node-cron'
import { logger } from '@/index.js'
import prisma from '@/prisma.js'
import { runScanWithLog, appendScanLogErrors } from './email-parser.js'
import { processNewBill, processReminderRules, processOverdueBills } from './notification.js'
import { getSetting, setSetting, KEYS } from './settings.js'

const DEFAULT_SCAN_INTERVAL = 24 // hours

async function shouldScan(): Promise<boolean> {
  const intervalStr = await getSetting(KEYS.SCAN_INTERVAL)
  const interval = intervalStr != null ? parseInt(intervalStr) : DEFAULT_SCAN_INTERVAL

  // 0 = disabled
  if (interval <= 0) {
    logger.debug('Auto scan disabled by user')
    return false
  }

  const lastStr = await getSetting(KEYS.LAST_SCAN_AT)
  if (!lastStr) return true

  const elapsed = Date.now() - new Date(lastStr).getTime()
  const intervalMs = interval * 60 * 60 * 1000

  if (elapsed < intervalMs) {
    logger.debug({ hoursRemaining: ((intervalMs - elapsed) / 3600000).toFixed(1) }, 'Scan interval not reached, skipping')
    return false
  }

  return true
}

/** Users whose mailbox is configured and who are not deactivated. */
export async function listScannableUsers() {
  return prisma.user.findMany({
    where: { deletedAt: null, imapUser: { not: null }, imapPassword: { not: null } },
    orderBy: { createdAt: 'asc' },
  })
}

export function startScheduler() {
  // Check every hour whether it's time to scan emails
  cron.schedule('0 * * * *', async () => {
    if (!(await shouldScan())) return

    const users = await listScannableUsers()
    if (users.length === 0) return
    logger.info({ users: users.length }, 'Scanning emails for all configured users...')

    for (const user of users) {
      try {
        const { result, scanLogId } = await runScanWithLog('cron', user)
        logger.info({ user: user.username, scanned: result.scanned, newBills: result.newBills.length }, 'Email scan complete')

        const notifyErrors = []
        for (const { bill, bank, warning } of result.newBills) {
          try {
            await processNewBill(bill, bank, warning)
          } catch (e) {
            notifyErrors.push({
              stage: 'notification' as const,
              bank: bank.name,
              reason: `通知發送失敗：${(e as Error).message}`,
            })
          }
        }
        if (notifyErrors.length > 0) {
          await appendScanLogErrors(scanLogId, notifyErrors)
        }
        if (result.errors.length > 0 || notifyErrors.length > 0) {
          logger.warn({ user: user.username, errors: [...result.errors, ...notifyErrors] }, 'Email scan had errors')
        }
      } catch (err) {
        // One user's mailbox failing must not stop the others.
        logger.error({ user: user.username, err }, 'Email scan failed for user')
      }
    }
    await setSetting(KEYS.LAST_SCAN_AT, new Date().toISOString())
  }, { timezone: 'Asia/Taipei' })

  // Process reminders every 15 minutes (honors each rule's timeOfDay)
  cron.schedule('*/15 * * * *', async () => {
    logger.debug('Processing reminder rules...')
    try {
      await processReminderRules()
      await processOverdueBills()
      logger.info('Reminder processing complete')
    } catch (err) {
      logger.error(err, 'Reminder processing failed')
    }
  }, { timezone: 'Asia/Taipei' })

  logger.info('Cron jobs started')
}
