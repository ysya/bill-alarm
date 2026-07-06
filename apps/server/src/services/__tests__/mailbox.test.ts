import { describe, it, expect } from 'vitest'
import { setupTestDb } from './helpers/test-db.js'

setupTestDb()
process.env.LOG_LEVEL = 'silent'

const { default: prisma } = await import('@/prisma.js')
const { getEmailProviderFor } = await import('../email/index.js')
const { listScannableUsers } = await import('../scheduler.js')
const { eventVisibleTo } = await import('../scan-events.js')

describe('per-user mailbox', () => {
  it('getEmailProviderFor: null without credentials, instance with them, defaults applied', () => {
    expect(getEmailProviderFor({ imapHost: null, imapPort: null, imapUser: null, imapPassword: null })).toBeNull()
    expect(getEmailProviderFor({ imapHost: null, imapPort: null, imapUser: 'a@b.c', imapPassword: null })).toBeNull()
    const p = getEmailProviderFor({ imapHost: null, imapPort: null, imapUser: 'a@b.c', imapPassword: 'pw' })
    expect(p).not.toBeNull()
  })

  it('listScannableUsers: only configured, non-deactivated users', async () => {
    await prisma.user.createMany({
      data: [
        { username: 'cfg', passwordHash: 'x:y', role: 'admin', imapUser: 'a@b.c', imapPassword: 'pw' },
        { username: 'nocfg', passwordHash: 'x:y', role: 'member' },
        { username: 'gone', passwordHash: 'x:y', role: 'member', imapUser: 'g@b.c', imapPassword: 'pw', deletedAt: new Date() },
      ],
    })
    const users = await listScannableUsers()
    expect(users.map(u => u.username)).toEqual(['cfg'])
  })

  it('eventVisibleTo filters by userId', () => {
    const e = { type: 'start' as const, scanLogId: 'x', total: 1, trigger: 'manual' as const, userId: 'u1' }
    expect(eventVisibleTo(e, 'u1')).toBe(true)
    expect(eventVisibleTo(e, 'u2')).toBe(false)
  })

  it('scan without configured mailbox reports 信箱未設定 and scans nothing', async () => {
    const { scanAndProcessEmails } = await import('../email-parser.js')
    const u = await prisma.user.create({ data: { username: 'bare', passwordHash: 'x:y', role: 'member' } })
    const result = await scanAndProcessEmails({ id: u.id, imapHost: null, imapPort: null, imapUser: null, imapPassword: null })
    expect(result.scanned).toBe(0)
    expect(result.errors[0].reason).toContain('信箱未設定')
  })
})
