import { EventEmitter } from 'node:events'
import type { ScanEvent } from '@bill-alarm/shared/scan'

export type { ScanEvent }

export interface ScanSnapshot {
  start: Extract<ScanEvent, { type: 'start' }>
  progress: Extract<ScanEvent, { type: 'progress' }> | null
}

class ScanEventBus extends EventEmitter {
  /**
   * Latest snapshot of each user's currently running scan, keyed by userId.
   * A user's entry is cleared when their scan completes. Lets newly-connected
   * SSE clients (e.g. after a page refresh) catch up to the in-progress state
   * without leaking another user's snapshot (one global slot would let
   * concurrent scans clobber each other).
   */
  private snapshots = new Map<string, ScanSnapshot>()

  emitEvent(e: ScanEvent) {
    if (e.type === 'start') {
      this.snapshots.set(e.userId, { start: e, progress: null })
    } else if (e.type === 'progress') {
      const snapshot = this.snapshots.get(e.userId)
      if (snapshot && snapshot.start.scanLogId === e.scanLogId) {
        snapshot.progress = e
      }
    } else if (e.type === 'complete') {
      this.snapshots.delete(e.userId)
    }
    this.emit('scan', e)
  }

  getSnapshot(userId: string): ScanSnapshot | null {
    return this.snapshots.get(userId) ?? null
  }
}

export const scanEvents = new ScanEventBus()
// SSE clients + scheduler can both listen — bump the cap to be safe.
scanEvents.setMaxListeners(50)

export function eventVisibleTo(e: ScanEvent, userId: string): boolean {
  return e.userId === userId
}
