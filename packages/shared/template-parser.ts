import { z } from 'zod'

// --- Template Parser Types ---

export type FieldType = 'amount' | 'rocDate' | 'adDate' | 'yearMonth'

export interface FieldRule {
  keyword: string
  type: FieldType
  nth?: number // default 1
}

export interface TemplateParserConfig {
  amount: FieldRule
  dueDate: FieldRule
  minimumPayment?: FieldRule
  billingPeriod?: FieldRule // omit to derive from dueDate
}

export const FIELD_TYPES: { value: FieldType; label: string }[] = [
  { value: 'amount', label: '金額' },
  { value: 'rocDate', label: '民國年日期' },
  { value: 'adDate', label: '西元年日期' },
  { value: 'yearMonth', label: '年月' },
]

export const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  amount: '金額 (如 69,988)',
  rocDate: '民國年日期 (如 115/04/03)',
  adDate: '西元年日期 (如 2026/04/03)',
  yearMonth: '年月 (如 115年03月)',
}

// --- Validation (used on write, e.g. banks.parserConfig PATCH) ---

export const fieldRuleSchema = z.object({
  keyword: z.string().min(1),
  type: z.enum(['amount', 'rocDate', 'adDate', 'yearMonth']),
  nth: z.number().int().positive().optional(),
})

export const templateParserConfigSchema = z.object({
  amount: fieldRuleSchema,
  dueDate: fieldRuleSchema,
  minimumPayment: fieldRuleSchema.optional(),
  billingPeriod: fieldRuleSchema.optional(),
})
