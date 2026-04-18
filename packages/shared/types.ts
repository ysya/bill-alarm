export enum BillStatus {
  PENDING = 'pending',
  PAID = 'paid',
  OVERDUE = 'overdue',
}

export type NotificationChannel = 'telegram' | 'calendar'

export interface ParsedBill {
  amount: number
  minimumPayment?: number
  dueDate: Date
  billingPeriod: string
}

/** API 回傳的帳單（列表用） */
export interface BillDTO {
  id: string
  bank?: { name: string }
  amount: number
  minimumPayment?: number
  dueDate: string
  status: BillStatus
  billingPeriod: string
  pdfPath?: string | null
  parseSource?: 'template' | 'hardcoded' | 'generic' | 'llm' | null
}

/** API 回傳的帳單詳情 */
export interface BillDetailDTO extends BillDTO {
  rawEmailSnippet?: string
  notifications?: NotificationDTO[]
  createdAt?: string
  paidAt?: string | null
}

export interface NotificationDTO {
  id?: string
  channel: string
  success: boolean
  sentAt: string
  message?: string
}

/** Dashboard 摘要 */
export interface BillSummaryDTO {
  totalPending: number
  pendingCount: number
  paidCount: number
  overdueCount: number
  nextDueDate: string | null
}

export interface BankAccountDTO {
  id: string
  name: string
  bankName: string
  note?: string | null
}

export interface BillBreakdownItem {
  bankId: string
  bankName: string
  totalAmount: number
  billCount: number
  autoDebit: boolean
}

export interface BillTimelineItem {
  id: string
  bankName: string
  amount: number
  dueDate: string
  status: BillStatus
  autoDebit: boolean
}

export interface MonthlySummaryDTO extends BillSummaryDTO {
  breakdown?: BillBreakdownItem[]
  timeline?: BillTimelineItem[]
}

// --- Shared helpers ---

export const BILL_STATUS_LABELS: Record<BillStatus, string> = {
  [BillStatus.PENDING]: '待繳',
  [BillStatus.PAID]: '已繳',
  [BillStatus.OVERDUE]: '逾期',
}

export const BILL_STATUS_BADGE_CLASS: Record<BillStatus, string> = {
  [BillStatus.PENDING]: 'bg-yellow-500/15 text-yellow-500 border-yellow-500/25 hover:bg-yellow-500/15',
  [BillStatus.PAID]: 'bg-green-500/15 text-green-500 border-green-500/25 hover:bg-green-500/15',
  [BillStatus.OVERDUE]: 'bg-red-500/15 text-red-500 border-red-500/25 hover:bg-red-500/15',
}

export function statusLabel(status: string): string {
  return BILL_STATUS_LABELS[status as BillStatus] ?? status
}

export function statusBadgeClass(status: string): string {
  return BILL_STATUS_BADGE_CLASS[status as BillStatus] ?? ''
}
