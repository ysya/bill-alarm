import { toast } from 'vue-sonner'

/** Single source of truth for manual scan triggering + result toasts. */
export function useScanTrigger() {
  const settingsApi = useSettingsApi()
  const scanning = ref(false)

  async function triggerScan(onDone?: () => void) {
    scanning.value = true
    try {
      const result = await settingsApi.triggerScan()
      const errorCount = result.errors?.length ?? 0
      const firstReason = result.errors?.[0]?.reason
      const summary = `掃描 ${result.scanned} 封郵件，發現 ${result.newBills} 筆新帳單${errorCount > 0 ? `，${errorCount} 個錯誤` : ''}。`
      const desc = errorCount > 0 && firstReason ? `${summary}\n首個錯誤：${firstReason}` : summary
      const action = { label: '查看紀錄', onClick: () => navigateTo('/scan-logs') }
      if (errorCount > 0) {
        toast.warning('郵件掃描完成（有錯誤）', { description: desc, action })
      }
      else {
        toast.success('郵件掃描完成', { description: desc, action })
      }
    }
    catch (e) {
      console.error('[scan] failed:', e)
      const status = (e as { response?: { status?: number } })?.response?.status
      const desc = status === 404
        ? '掃描端點不存在 (HTTP 404) — 請強制重整網頁或確認 server 已更新到最新版本'
        : status
          ? `HTTP ${status}：${(e as Error).message}`
          : String(e)
      toast.error('掃描失敗', { description: desc })
    }
    finally {
      scanning.value = false
      onDone?.()
    }
  }

  return { scanning, triggerScan }
}
