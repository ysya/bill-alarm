import { describe, it, expect, beforeEach } from 'vitest'
import { setupTestDb } from './helpers/test-db.js'

setupTestDb()
process.env.LOG_LEVEL = 'silent'

const { default: prisma } = await import('@/prisma.js')
const { getEffectivePrefs, normalizeRemindDays, DEFAULT_PREFS } = await import('../notification-prefs.js')

beforeEach(async () => {
  await prisma.notificationPreference.deleteMany()
  await prisma.user.deleteMany()
})

async function seedUser(username = 'alice') {
  return prisma.user.create({ data: { username, passwordHash: 'x:y', role: 'member' } })
}

describe('normalizeRemindDays', () => {
  it('dedupes and sorts descending', () => {
    expect(normalizeRemindDays([1, 3, 3, 7])).toEqual([7, 3, 1])
  })
})

describe('getEffectivePrefs', () => {
  it('falls back to DEFAULT_PREFS when no row exists', async () => {
    const user = await seedUser()
    const prefs = await getEffectivePrefs(user.id)
    expect(prefs).toEqual(DEFAULT_PREFS)
  })

  it('parses and normalizes a stored row', async () => {
    const user = await seedUser()
    await prisma.notificationPreference.create({
      data: { userId: user.id, remindDays: '[1,7,3]', remindTime: '21:30', notifyNewBill: false, notifyOverdue: true },
    })
    const prefs = await getEffectivePrefs(user.id)
    expect(prefs).toEqual({ remindDays: [7, 3, 1], remindTime: '21:30', notifyNewBill: false, notifyOverdue: true })
  })

  it('empty remindDays means reminders off, not defaults', async () => {
    const user = await seedUser()
    await prisma.notificationPreference.create({ data: { userId: user.id, remindDays: '[]' } })
    const prefs = await getEffectivePrefs(user.id)
    expect(prefs.remindDays).toEqual([])
  })
})
