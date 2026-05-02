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

export type ScanItemStatus = 'matched' | 'success' | 'error' | 'skipped'

export interface ScanProgressState {
  active: boolean
  trigger: 'manual' | 'cron' | null
  scanLogId: string | null
  total: number
  idx: number
  bank: string | null
  lastStatus: ScanItemStatus | null
  lastReason: string | null
}

/**
 * Subscribes to /api/system/scan-events via EventSource and exposes a reactive
 * progress state. The EventSource is opened on mount and closed on unmount.
 */
export function useScanEvents() {
  const state = ref<ScanProgressState>({
    active: false,
    trigger: null,
    scanLogId: null,
    total: 0,
    idx: 0,
    bank: null,
    lastStatus: null,
    lastReason: null,
  })

  const onComplete = ref<((e: Extract<ScanEvent, { type: 'complete' }>) => void) | null>(null)

  let es: EventSource | null = null

  function handleStart(e: Extract<ScanEvent, { type: 'start' }>) {
    state.value = {
      active: true,
      trigger: e.trigger,
      scanLogId: e.scanLogId,
      total: e.total,
      idx: 0,
      bank: null,
      lastStatus: null,
      lastReason: null,
    }
  }

  function handleProgress(e: Extract<ScanEvent, { type: 'progress' }>) {
    state.value = {
      ...state.value,
      active: true,
      scanLogId: e.scanLogId,
      total: e.total,
      idx: e.idx,
      bank: e.bank ?? null,
      lastStatus: e.status,
      lastReason: e.reason ?? null,
    }
  }

  function handleComplete(e: Extract<ScanEvent, { type: 'complete' }>) {
    state.value = {
      ...state.value,
      active: false,
    }
    onComplete.value?.(e)
  }

  function open() {
    if (es) return
    es = new EventSource('/api/scan-events')
    es.addEventListener('start', (ev) => {
      try { handleStart(JSON.parse((ev as MessageEvent).data)) } catch { /* ignore */ }
    })
    es.addEventListener('progress', (ev) => {
      try { handleProgress(JSON.parse((ev as MessageEvent).data)) } catch { /* ignore */ }
    })
    es.addEventListener('complete', (ev) => {
      try { handleComplete(JSON.parse((ev as MessageEvent).data)) } catch { /* ignore */ }
    })
    // hello / ping events are ignored — EventSource auto-reconnects on error.
  }

  function close() {
    if (es) {
      es.close()
      es = null
    }
  }

  onMounted(open)
  onUnmounted(close)

  return {
    state,
    onComplete,
  }
}
