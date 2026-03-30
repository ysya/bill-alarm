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
