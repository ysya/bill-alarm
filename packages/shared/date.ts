// All calendar-day logic in this repo goes through this module.
// A "YMD" is a 'YYYY-MM-DD' string; comparisons and sorting are plain
// string operations, which match date order lexicographically.

/** Split a YMD (or YM) string into numeric parts. Callers are expected to
 *  pass well-formed 'YYYY-MM-DD' (or 'YYYY-MM') strings per the module
 *  convention above — the non-null assertion just satisfies
 *  noUncheckedIndexedAccess, it performs no extra validation. */
function parseYMD(ymd: string): [number, number, number] {
  const [y, m, d] = ymd.split('-').map(Number)
  return [y!, m!, d!]
}

export function isValidYMD(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const [y, m, d] = parseYMD(s)
  if (m < 1 || m > 12 || d < 1) return false
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return d <= daysInMonth
}

/** Today's calendar date in the runtime's local timezone. */
export function todayYMD(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

export function addDaysYMD(ymd: string, days: number): string {
  const [y, m, d] = parseYMD(ymd)
  const dt = new Date(Date.UTC(y, m - 1, d + days))
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`
}

/** Whole calendar days from today (local) to ymd. Negative = overdue. */
export function daysUntil(ymd: string, now: Date = new Date()): number {
  const [y, m, d] = parseYMD(ymd)
  const [ty, tm, td] = parseYMD(todayYMD(now))
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(ty, tm - 1, td)) / 86_400_000)
}

export function formatYMD(ymd: string): string {
  return ymd.replaceAll('-', '/')
}

/** Statement period fallback: the month before the due date. Pure arithmetic —
 *  Date#setMonth would overflow on month-end days (29–31). */
export function deriveBillingPeriod(dueYMD: string): string {
  const [y, m] = parseYMD(dueYMD)
  const prevYear = m === 1 ? y - 1 : y
  const prevMonth = m === 1 ? 12 : m - 1
  return `${prevYear}-${String(prevMonth).padStart(2, '0')}`
}

/** Build a YMD from parsed fragments, converting ROC years (<200 → +1911).
 *  Returns null for impossible dates or years outside 2020–2100. */
export function ymdFromParts(yearStr: string, monthStr: string, dayStr: string): string | null {
  let year = parseInt(yearStr, 10)
  const month = parseInt(monthStr, 10)
  const day = parseInt(dayStr, 10)
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null
  if (year < 200) year += 1911
  if (year < 2020 || year > 2100) return null
  const s = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  return isValidYMD(s) ? s : null
}
