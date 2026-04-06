/**
 * 用已擷取的 PDF 文字測試 HSBC parser。
 * Usage: cd apps/server && npx tsx scripts/test-hsbc-parser.ts
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { hsbcTwParser as hsbcParser } from '../src/parsers/hsbc.js'

const TMP = path.resolve(import.meta.dirname, '../tmp')

// Expected values based on email subjects and manual inspection
const expected = [
  { file: 'email1_pdf1.txt', period: '2026-01', amount: 0, min: undefined, due: '2026-01-21' },
  { file: 'email2_pdf1.txt', period: '2025-12', amount: 8000, min: undefined, due: '2025-12-21' },
  { file: 'email3_pdf1.txt', period: '2025-11', amount: 0, min: undefined, due: '2025-11-21' },
  { file: 'email4_pdf1.txt', period: '2025-10', amount: 34258, min: 3498, due: '2025-10-21' },
  { file: 'email5_pdf1.txt', period: '2025-09', amount: 3342, min: 1031, due: '2025-09-21' },
]

let pass = 0
let fail = 0

for (const exp of expected) {
  const filePath = path.join(TMP, exp.file)
  let text: string
  try {
    text = await fs.readFile(filePath, 'utf-8')
  } catch {
    console.log(`⚠ SKIP ${exp.file} (not found)`)
    continue
  }

  const result = hsbcParser.parse(text)
  // Use local date string (not UTC) to avoid timezone shift
  const d = result?.dueDate
  const dueStr = d
    ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    : null

  const checks = [
    { field: 'amount', got: result?.amount, want: exp.amount },
    { field: 'dueDate', got: dueStr, want: exp.due },
    { field: 'billingPeriod', got: result?.billingPeriod, want: exp.period },
    { field: 'minimumPayment', got: result?.minimumPayment, want: exp.min },
  ]

  const failures = checks.filter(c => String(c.got) !== String(c.want))

  if (failures.length === 0) {
    console.log(`✓ ${exp.file} — amount=${exp.amount}, due=${exp.due}, period=${exp.period}, min=${exp.min ?? 'N/A'}`)
    pass++
  } else {
    console.log(`✗ ${exp.file}`)
    for (const f of failures) {
      console.log(`    ${f.field}: got ${f.got}, want ${f.want}`)
    }
    fail++
  }
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail > 0 ? 1 : 0)
