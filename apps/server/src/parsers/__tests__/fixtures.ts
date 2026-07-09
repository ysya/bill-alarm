// Synthetic, de-identified characterization fixtures for the 8 hardcoded bank
// parsers. Every value is fake: ROC year 115 (= AD 2026), obviously-round
// amounts, no card numbers / names / addresses. Each `text` is hand-built to
// hit its parser's FIRST-priority regex (see per-bank notes), and each
// `expected` was locked only after running the parser and hand-verifying that
// the extracted amount is 本期應繳總額 (not min / not previous balance), the
// dueDate is 繳款截止日, and billingPeriod is the statement month.
//
// This is a characterization suite: it pins CURRENT parser behavior. See
// task-13-report.md for two documented parser quirks (esun amount column,
// yuanta negative-amount abs) that these fixtures deliberately steer around.

export interface ParserFixture {
  text: string
  expected: {
    amount: number
    dueDate: string
    minimumPayment?: number
    billingPeriod?: string
  }
}

export const FIXTURES: Record<string, ParserFixture> = {
  // 玉山: amount regex 1 (本期應繳總金額…\nTWD 0 A A B — captures 2nd field),
  // dueDate regex 1 (two consecutive `N 元` lines then a ROC date),
  // min regex 1 (4th field of the TWD row), billingPeriod via 「115年02月…信用卡」.
  esun: {
    text: [
      '115年02月 信用卡帳單',
      '本期應繳總金額 本期最低應繳金額',
      'TWD 0 69,988 69,988 6,999',
      '69,988 元',
      '6,999 元',
      '115/04/13',
    ].join('\n'),
    expected: { amount: 69988, dueDate: '2026-04-13', minimumPayment: 6999, billingPeriod: '2026-02' },
  },

  // 元大: single header+values pair. amount = 3rd value (本期應繳總額),
  // min = 4th value (本期最低應繳金額), dueDate = 5th value (繳款截止日).
  // Positive values used on purpose (see report: parseAmount does NOT abs).
  yuanta: {
    text: [
      '115年02月信用卡消費明細表',
      '前期帳單總額 已繳款(含回饋/調整) 本期應繳總額 本期最低應繳金額 繳款截止日',
      '0 0 45,000 4,500 115/03/26',
    ].join('\n'),
    expected: { amount: 45000, dueDate: '2026-03-26', minimumPayment: 4500, billingPeriod: '2026-02' },
  },

  // 中國信託: 表頭 block. 帳期(115/03) then 截止日(115/04/08) then
  // 應繳金額 / 最低應繳 / 額度 on their own lines. amount regex 1,
  // dueDate regex 1, min regex 1, billingPeriod from 「115/03」.
  ctbc: {
    text: [
      '115/03',
      '115/04/08',
      '7,833',
      '1,000',
      '500,000',
      '本期消費明細',
    ].join('\n'),
    expected: { amount: 7833, dueDate: '2026-04-08', minimumPayment: 1000, billingPeriod: '2026-03' },
  },

  // 台新: tab-separated key/value. amount regex 1 (=本期累計應繳金額),
  // dueDate (繳款截止日), min (本期最低應繳金額), billingPeriod 「115年 03月…信用卡」.
  taishin: {
    text: [
      '帳期：115年 03月 信用卡電子帳單',
      '繳款截止日\t115/04/13',
      '=本期累計應繳金額\t1,350',
      '本期最低應繳金額\t1,000',
    ].join('\n'),
    expected: { amount: 1350, dueDate: '2026-04-13', minimumPayment: 1000, billingPeriod: '2026-03' },
  },

  // 永豐: 西元 dates. 臺幣 row has 7 numeric columns; amount = 6th
  // (本期應繳總金額), min = 7th (最低應繳). dueDate from 「繳款截止日2026/04/08」,
  // billingPeriod from 「2026年3月…信用卡」 (4-digit-year branch).
  sinopac: {
    text: [
      '2026年3月 信用卡電子帳單',
      '您的繳款截止日2026/04/08',
      '臺幣 0 0 12,340 0 0 12,340 1,234',
    ].join('\n'),
    expected: { amount: 12340, dueDate: '2026-04-08', minimumPayment: 1234, billingPeriod: '2026-03' },
  },

  // 聯邦: title line ends 「消費帳單：」; next line is「應繳總金額 最低應繳金額」;
  // then the ROC 繳款截止日. billingPeriod is always deriveBillingPeriod(due).
  ubot: {
    text: [
      '以下為您03月份之信用卡消費帳單：',
      '8,888 800',
      '115/04/03',
      '115/03/20',
    ].join('\n'),
    expected: { amount: 8888, dueDate: '2026-04-03', minimumPayment: 800, billingPeriod: '2026-03' },
  },

  // 國泰世華: 帳期 same month as 截止日 (must NOT derive). Two consecutive ROC
  // dates = 結帳日 then 繳款截止日 (captures the 2nd); 應繳金額 then 最低應繳;
  // amount from 「本期應繳總額 N」; billingPeriod from 「信用卡帳單 115年03月」.
  cathay: {
    text: [
      '信用卡帳單 115年03月',
      '115/03/02',
      '115/03/18',
      '2,580',
      '258',
      '本期應繳總額 2,580',
    ].join('\n'),
    expected: { amount: 2580, dueDate: '2026-03-18', minimumPayment: 258, billingPeriod: '2026-03' },
  },

  // 滙豐: labels are images, only bare numbers survive extraction. First
  // YYYY/MM/DD = 繳費截止日; after the interest-rate「%」the first 6 numbers are
  // prev/paid/net/new/total/min → amount = 5th, min = 6th. billingPeriod =
  // due month (HSBC 帳期與截止日同月). No 16-digit card number in fixture.
  hsbc_tw: {
    text: [
      '2026/04/15',
      '09.680%',
      '0',
      '0',
      '0',
      '33,000',
      '33,000',
      '3,300',
    ].join('\n'),
    expected: { amount: 33000, dueDate: '2026-04-15', minimumPayment: 3300, billingPeriod: '2026-04' },
  },
}
