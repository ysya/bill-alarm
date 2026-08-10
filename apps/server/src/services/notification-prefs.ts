import prisma from '@/prisma.js'

export interface EffectivePrefs {
  remindDays: number[]
  remindTime: string
  notifyNewBill: boolean
  notifyOverdue: boolean
}

/** The ONLY place defaults live. Absent row ⇒ these values, for every reader. */
export const DEFAULT_PREFS: EffectivePrefs = {
  remindDays: [3, 1],
  remindTime: '09:00',
  notifyNewBill: true,
  notifyOverdue: true,
}

/** Canonical order for storage and responses: dedupe + sort descending. */
export function normalizeRemindDays(days: number[]): number[] {
  return [...new Set(days)].sort((a, b) => b - a)
}

/** Read a user's prefs; absent row = shared defaults (no row is created here). */
export async function getEffectivePrefs(userId: string): Promise<EffectivePrefs> {
  const row = await prisma.notificationPreference.findUnique({ where: { userId } })
  if (!row) return { ...DEFAULT_PREFS, remindDays: [...DEFAULT_PREFS.remindDays] }
  return {
    remindDays: normalizeRemindDays(JSON.parse(row.remindDays)),
    remindTime: row.remindTime,
    notifyNewBill: row.notifyNewBill,
    notifyOverdue: row.notifyOverdue,
  }
}
