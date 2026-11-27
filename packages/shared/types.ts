export enum BillStatus {
  PENDING = 'pending',
  PAID = 'paid',
  OVERDUE = 'overdue',
  NO_PAYMENT = 'no_payment',
}

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
  bank?: { id: string, name: string, code: string | null, autoDebit: boolean, isActive: boolean, bankAccountId: string | null }
  amount: number
  minimumPayment?: number
  dueDate: string
  status: BillStatus
  billingPeriod: string
  pdfPath?: string | null
  paidAt?: string | null
  transferredAt?: string | null
  transferredAmount?: number | null
  transferredAccountId?: string | null
  paidByAutoDebit?: boolean
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
  totalTransferred: number
  totalToFund: number
  paidBillingPeriod: string
  fundingAccounts: FundingAccountSummary[]
  tasks: {
    overdue: BillDTO[]
    upcoming: BillDTO[]
    awaiting: BillDTO[]
    upcomingCount: number
    awaitingCount: number
  }
  pendingCount: number
  paidCount: number
  overdueCount: number
  nextDueDate: string | null
}

export interface FundingAccountSummary {
  id: string | null
  name: string
  bankName: string | null
  remaining: number
  nextDueDate: string
  bills: { id: string, name: string, period: string, dueDate: string, remaining: number }[]
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

/** 使用者名下帳單最近一次通知發送的結果（浮出靜默失敗用） */
export interface LastDeliveryDTO {
  sentAt: string
  success: boolean
  message: string
  errorMessage?: string | null
}

/** GET/PUT /notification-prefs。lastDelivery 只在 GET 回應出現。 */
export interface NotificationPrefsDTO {
  remindDays: number[]
  remindTime: string
  notifyNewBill: boolean
  notifyOverdue: boolean
  notifyDebitConfirmation: boolean
  lastDelivery?: LastDeliveryDTO | null
}

/** GET /onboarding-status — 儀表板設定進度卡 */
export interface OnboardingStatusDTO {
  emailConfigured: boolean
  hasActiveBank: boolean
  botConfigured: boolean
  telegramBound: boolean
}

export interface BillBreakdownItem {
  bankId: string
  bankName: string
  totalAmount: number
  billCount: number
  autoDebit: boolean
}

export interface MonthlySummaryDTO extends BillSummaryDTO {
  breakdown?: BillBreakdownItem[]
}

// --- Shared helpers ---

type BillFunding = Pick<BillDTO, 'amount' | 'transferredAmount'>

export function fundingRemaining(bill: BillFunding): number {
  return Math.max(0, bill.amount - Math.max(0, bill.transferredAmount ?? 0))
}

export function isAwaitingDebit(bill: BillFunding & { status: string, transferredAt?: string | Date | null }): boolean {
  return (bill.status === BillStatus.PENDING || bill.status === BillStatus.OVERDUE)
    && Boolean(bill.transferredAt) && bill.transferredAmount != null && fundingRemaining(bill) === 0
}

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
