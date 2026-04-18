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

// --- Presets for known banks ---

export const TEMPLATE_PRESETS: Record<string, TemplateParserConfig> = {
  ubot: {
    amount: { keyword: '消費帳單', type: 'amount', nth: 1 },
    dueDate: { keyword: '消費帳單', type: 'rocDate', nth: 1 },
    minimumPayment: { keyword: '消費帳單', type: 'amount', nth: 2 },
  },
  yuanta: {
    amount: { keyword: '繳款截止日', type: 'amount', nth: 3 },
    dueDate: { keyword: '繳款截止日', type: 'rocDate', nth: 1 },
    minimumPayment: { keyword: '繳款截止日', type: 'amount', nth: 4 },
    billingPeriod: { keyword: '信用卡', type: 'yearMonth', nth: 1 },
  },
  taishin: {
    amount: { keyword: '應繳金額', type: 'amount', nth: 1 },
    dueDate: { keyword: '繳款截止日', type: 'rocDate', nth: 1 },
    minimumPayment: { keyword: '最低應繳金額', type: 'amount', nth: 1 },
    billingPeriod: { keyword: '信用卡', type: 'yearMonth', nth: 1 },
  },
  sinopac: {
    amount: { keyword: '臺幣', type: 'amount', nth: 6 },
    dueDate: { keyword: '繳款截止日', type: 'adDate', nth: 1 },
    minimumPayment: { keyword: '臺幣', type: 'amount', nth: 7 },
    billingPeriod: { keyword: '信用卡', type: 'yearMonth', nth: 1 },
  },
  cathay: {
    amount: { keyword: '本期應繳總額', type: 'amount', nth: 1 },
    dueDate: { keyword: '結帳日', type: 'rocDate', nth: 2 },
    minimumPayment: { keyword: '本期應繳總額', type: 'amount', nth: 2 },
    billingPeriod: { keyword: '信用卡帳單', type: 'yearMonth', nth: 1 },
  },
}
