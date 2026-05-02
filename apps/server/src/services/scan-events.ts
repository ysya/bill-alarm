import { EventEmitter } from 'node:events'

export type ScanEvent =
  | {
      type: 'start'
      scanLogId: string
      total: number
      trigger: 'manual' | 'cron'
    }
  | {
      type: 'progress'
      scanLogId: string
      idx: number
      total: number
      bank?: string
      status: 'matched' | 'success' | 'error' | 'skipped'
      reason?: string
    }
  | {
      type: 'complete'
      scanLogId: string
      scanned: number
      newBills: number
      errorCount: number
    }

export interface ScanSnapshot {
  start: Extract<ScanEvent, { type: 'start' }>
  progress: Extract<ScanEvent, { type: 'progress' }> | null
}

class ScanEventBus extends EventEmitter {
  /**
   * Latest snapshot of the currently running scan, if any.
   * Cleared when the scan completes. Lets newly-connected SSE clients
   * (e.g. after a page refresh) catch up to the in-progress state.
   */
  private snapshot: ScanSnapshot | null = null

  emitEvent(e: ScanEvent) {
    if (e.type === 'start') {
      this.snapshot = { start: e, progress: null }
    } else if (e.type === 'progress' && this.snapshot && this.snapshot.start.scanLogId === e.scanLogId) {
      this.snapshot.progress = e
    } else if (e.type === 'complete') {
      this.snapshot = null
    }
    this.emit('scan', e)
  }

  getSnapshot(): ScanSnapshot | null {
    return this.snapshot
  }
}

export const scanEvents = new ScanEventBus()
// SSE clients + scheduler can both listen — bump the cap to be safe.
scanEvents.setMaxListeners(50)
