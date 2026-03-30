import cron from 'node-cron'
import { logger } from '../index.js'
import { scanAndProcessEmails } from './email-parser.js'
import { processNewBill, processReminderRules, processOverdueBills } from './notification.js'

export function startScheduler() {
  // Scan emails every hour
  cron.schedule('0 * * * *', async () => {
    logger.info('Scanning emails...')
    try {
      const result = await scanAndProcessEmails()
      logger.info({ scanned: result.scanned, newBills: result.newBills.length }, 'Email scan complete')

      for (const { bill, card } of result.newBills) {
        await processNewBill(bill, card)
      }

      if (result.errors.length > 0) {
        logger.warn({ errors: result.errors }, 'Email scan had errors')
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
