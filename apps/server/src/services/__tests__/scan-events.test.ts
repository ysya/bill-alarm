import { describe, it, expect } from 'vitest'
import { scanEvents } from '../scan-events.js'
import type { ScanEvent } from '@bill-alarm/shared/scan'

// Pure EventEmitter/Map state — no DB needed. scanEvents is a module-level
// singleton, so each test uses its own unique userIds to stay isolated from
// the others without needing a reset hook.

function startEvent(userId: string, scanLogId: string): Extract<ScanEvent, { type: 'start' }> {
  return { type: 'start', userId, scanLogId, total: 5, trigger: 'manual' }
}
function progressEvent(userId: string, scanLogId: string, idx: number): Extract<ScanEvent, { type: 'progress' }> {
  return { type: 'progress', userId, scanLogId, idx, total: 10, status: 'matched' }
}
function completeEvent(userId: string, scanLogId: string): Extract<ScanEvent, { type: 'complete' }> {
  return { type: 'complete', userId, scanLogId, scanned: 5, newBills: 0, errorCount: 0 }
}

describe('ScanEventBus snapshot: per-user Map, not a single global slot', () => {
  it('getSnapshot returns null for a user with no in-progress scan', () => {
    expect(scanEvents.getSnapshot('snap-never-scanned')).toBeNull()
  })

  it('two different users starting scans do not clobber each other\'s snapshot', () => {
    scanEvents.emitEvent(startEvent('snap-user-a', 'log-a'))
    scanEvents.emitEvent(startEvent('snap-user-b', 'log-b'))

    expect(scanEvents.getSnapshot('snap-user-a')?.start.scanLogId).toBe('log-a')
    expect(scanEvents.getSnapshot('snap-user-b')?.start.scanLogId).toBe('log-b')
  })

  it('a progress event updates only the matching user\'s snapshot', () => {
    scanEvents.emitEvent(startEvent('snap-user-c', 'log-c'))
    scanEvents.emitEvent(startEvent('snap-user-d', 'log-d'))

    scanEvents.emitEvent(progressEvent('snap-user-c', 'log-c', 3))

    expect(scanEvents.getSnapshot('snap-user-c')?.progress?.idx).toBe(3)
    expect(scanEvents.getSnapshot('snap-user-d')?.progress).toBeNull()
  })

  it('completing one user\'s scan clears only that user\'s snapshot, leaving the other user\'s untouched', () => {
    scanEvents.emitEvent(startEvent('snap-user-e', 'log-e'))
    scanEvents.emitEvent(startEvent('snap-user-f', 'log-f'))

    scanEvents.emitEvent(completeEvent('snap-user-f', 'log-f'))

    expect(scanEvents.getSnapshot('snap-user-f')).toBeNull()
    expect(scanEvents.getSnapshot('snap-user-e')?.start.scanLogId).toBe('log-e')
  })
})
