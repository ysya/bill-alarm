import { toast } from 'vue-sonner'

/** One-tap mark-paid with an Undo toast — the single implementation every
 *  entry point (dashboard, list, detail) shares. paidAt is always "today";
 *  backdating lives in the bill-detail edit mode. */
export function useMarkPaid() {
  const { markAsPaid, unpay } = useBillApi()
  const markingIds = ref<Set<string>>(new Set())

  async function markPaid(bill: { id: string, bank?: { name: string } | null }, onChanged: () => void) {
    if (markingIds.value.has(bill.id)) return
    markingIds.value.add(bill.id)
    const bankName = bill.bank?.name ?? '帳單'
    try {
      const paidBill = await markAsPaid(bill.id)
      onChanged()
      const dateLabel = paidBill.paidByAutoDebit ? '扣繳日' : '繳費日'
      const title = paidBill.paidByAutoDebit ? `已確認 ${bankName} 扣繳` : `已標記 ${bankName} 已繳`
      toast.success(`${title}（${dateLabel}：今天）`, {
        duration: 8000,
        description: `點「復原」可撤銷。可在帳單詳情修改${dateLabel}。`,
        action: {
          label: '復原',
          onClick: async () => {
            try {
              const restored = await unpay(bill.id)
              toast.success(restored.transferredAt ? `已復原 ${bankName} 為待扣繳` : `已復原 ${bankName} 為待繳`)
            }
            catch (e) {
              toast.error('復原失敗', { description: String(e) })
            }
            finally {
              onChanged() // 失敗也刷新，讓畫面回到伺服器真實狀態
            }
          },
        },
      })
    }
    catch (e) {
      toast.error('操作失敗', { description: String(e) })
    }
    finally {
      markingIds.value.delete(bill.id)
    }
  }

  return { markingIds, markPaid }
}
