import cron from 'node-cron'
import { logger } from '@/index.js'
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

export function startScheduler() {
  // Check every hour whether it's time to scan emails
  cron.schedule('0 * * * *', async () => {
    if (!(await shouldScan())) return

    logger.info('Scanning emails...')
    try {
      const { result, scanLogId } = await runScanWithLog('cron')
      await setSetting(KEYS.LAST_SCAN_AT, new Date().toISOString())
      logger.info({ scanned: result.scanned, newBills: result.newBills.length }, 'Email scan complete')

      const notifyErrors = []
      for (const { bill, bank } of result.newBills) {
        try {
          await processNewBill(bill, bank)
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
        logger.warn({ errors: [...result.errors, ...notifyErrors] }, 'Email scan had errors')
      }
    } catch (err) {
      logger.error(err, 'Email scan failed')
    }
  })

  // Process reminders daily at 00:05
  cron.schedule('5 0 * * *', async () => {
    logger.info('Processing reminder rules...')
    try {
      await processReminderRules()
      await processOverdueBills()
      logger.info('Reminder processing complete')
    } catch (err) {
      logger.error(err, 'Reminder processing failed')
    }
  })

  logger.info('Cron jobs started')
}
