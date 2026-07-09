export type ScanTrigger = 'manual' | 'cron'
export type ScanItemStatus = 'matched' | 'success' | 'error' | 'skipped'

export type ScanErrorStage =
  | 'email_search'
  | 'email_fetch'
  | 'pdf_password'
  | 'pdf_extract'
  | 'parse_failed'
  | 'sanity_check'
  | 'unexpected'
  | 'notification'

export interface ScanError {
  stage: ScanErrorStage
  reason: string
  bank?: string
  msgId?: string
}

export type ScanEvent =
  | { type: 'start'; userId: string; scanLogId: string; total: number; trigger: ScanTrigger }
  | {
      type: 'progress'
      userId: string
      scanLogId: string
      idx: number
      total: number
      bank?: string
      status: ScanItemStatus
      reason?: string
    }
  | {
      type: 'complete'
      userId: string
      scanLogId: string
      scanned: number
      newBills: number
      errorCount: number
    }

export interface ScanLogDTO {
  id: string
  trigger: ScanTrigger
  startedAt: string
  finishedAt: string | null
  scanned: number
  newBillsCount: number
  errorCount: number
  errors: ScanError[]
  fatalError: string | null
}
