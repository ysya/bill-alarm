export enum BillStatus {
  PENDING = 'pending',
  PAID = 'paid',
  OVERDUE = 'overdue',
  NO_PAYMENT = 'no_payment',
}

export type NotificationChannel = 'telegram' | 'calendar'

export interface ParsedBill {
  amount: number
  minimumPayment?: number
  dueDate: string // 'YYYY-MM-DD'
  billingPeriod: string
}

/**
 * API 回傳的帳單（列表用）。`bank` 在 GET /bills、GET /bills/:id 才會附上（完整子集
 * 欄位）；PATCH /bills/:id、/pay、/unpay、/reparse 回傳的是未 include 關聯的原始 row，
 * 故 bank 為 undefined —— 標成 optional 以反映實際回應。
 */
export interface BillDTO {
  id: string
  bank?: { id: string, name: string, code: string | null, autoDebit: boolean, isActive: boolean }
  amount: number
  minimumPayment?: number
  dueDate: string
  status: BillStatus
  billingPeriod: string
  pdfPath?: string | null
  paidAt?: string | null
  // 'generic': legacy rows only — the generic fallback parser was removed in 0.4;
  // new bills only ever write 'template' | 'hardcoded' | 'llm'.
  parseSource?: 'template' | 'hardcoded' | 'generic' | 'llm' | null
}

/** GET /bills 分頁列表回應 */
export interface BillListResponse {
  data: BillDTO[]
  total: number
  page: number
  pageSize: number
}

/** API 回傳的帳單詳情 */
export interface BillDetailDTO extends BillDTO {
  rawEmailSnippet?: string
  notifications?: NotificationDTO[]
  createdAt?: string
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

/** API 回傳的銀行設定（列表用）。pdfPassword 遮罩：只回 hasPdfPassword，不回明碼。 */
export interface BankDTO {
  id: string
  code: string | null
  name: string
  emailSenderPattern: string
  emailSubjectPattern: string
  parserConfig: string | null
  isBuiltin: boolean
  isActive: boolean
  autoDebit: boolean
  bankAccountId: string | null
  bankAccount?: BankAccountDTO | null
  hasPdfPassword: boolean
  _count?: { bills: number }
}

/** API 回傳的通知規則 */
export interface NotificationRuleDTO {
  id: string
  name: string
  daysBefore: number
  timeOfDay: string
  channels: string[]
  isActive: boolean
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
  [BillStatus.NO_PAYMENT]: '不需繳費',
}

export const BILL_STATUS_BADGE_CLASS: Record<BillStatus, string> = {
  [BillStatus.PENDING]: 'bg-yellow-500/15 text-yellow-500 border-yellow-500/25 hover:bg-yellow-500/15',
  [BillStatus.PAID]: 'bg-green-500/15 text-green-500 border-green-500/25 hover:bg-green-500/15',
  [BillStatus.OVERDUE]: 'bg-red-500/15 text-red-500 border-red-500/25 hover:bg-red-500/15',
  [BillStatus.NO_PAYMENT]: 'bg-blue-500/15 text-blue-500 border-blue-500/25 hover:bg-blue-500/15',
}

export function statusLabel(status: string): string {
  return BILL_STATUS_LABELS[status as BillStatus] ?? status
}

export function statusBadgeClass(status: string): string {
  return BILL_STATUS_BADGE_CLASS[status as BillStatus] ?? ''
}
