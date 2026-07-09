import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setupTestDb } from './helpers/test-db.js'
import type { SearchCriteria } from '../email/types.js'

const { searchMock } = vi.hoisted(() => ({
  // Typed via the generic param (not a named-arg implementation) so the mock
  // records `client.search(query, options)` calls without unused-param lint noise.
  searchMock: vi.fn<(query: any, options?: any) => Promise<number[] | false>>(),
}))

vi.mock('imapflow', () => ({
  // Must be a real class (not an arrow fn) — gmail-imap.ts calls `new ImapFlow(...)`.
  ImapFlow: class {
    constructor(public options: unknown) {}
    connect = vi.fn(async () => {})
    logout = vi.fn(async () => {})
    getMailboxLock = vi.fn(async () => ({ release: vi.fn(), path: 'INBOX' }))
    search = searchMock
    fetchOne = vi.fn(async () => null)
  },
}))

setupTestDb()
process.env.LOG_LEVEL = 'silent'

const { default: prisma } = await import('@/prisma.js')
const { getEmailProviderFor } = await import('../email/index.js')
const { GmailImapProvider } = await import('../email/providers/gmail-imap.js')
const { listScannableUsers } = await import('../scheduler.js')
const { eventVisibleTo } = await import('../scan-events.js')
const { setSetting, deleteSetting } = await import('../settings.js')

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

// GmailImapProvider.search() must dispatch on host: Gmail servers get the gmailraw
// (X-GM-RAW) extension query built from structured criteria; any other IMAP host
// (e.g. self-hosted, Fastmail, Outlook) gets a standard imapflow SearchObject —
// the Gmail-only string syntax silently failed there before this refactor.
describe('GmailImapProvider.search: structured criteria dispatch by host', () => {
  const criteria: SearchCriteria = {
    senders: ['hsbc@bank.com', 'esunbank@esunbank.com.tw'],
    sinceDays: 45,
    hasAttachment: true,
  }

  beforeEach(async () => {
    searchMock.mockReset()
    searchMock.mockResolvedValue([])
    await deleteSetting('scan_gmail_query_extra')
  })

  it('gmail host (imap.gmail.com): builds a gmailraw string with OR-joined senders, newer_than and has:attachment', async () => {
    const provider = new GmailImapProvider({ host: 'imap.gmail.com', port: 993, user: 'me@gmail.com', password: 'pw' })
    await provider.withSession((session) => session.search(criteria))

    expect(searchMock).toHaveBeenCalledTimes(1)
    const [query, opts] = searchMock.mock.calls[0]
    expect(opts).toEqual({ uid: true })
    expect(query).not.toHaveProperty('or')
    expect(query).not.toHaveProperty('since')
    expect(typeof query.gmailraw).toBe('string')
    expect(query.gmailraw).toContain('from:(hsbc@bank.com) OR from:(esunbank@esunbank.com.tw)')
    expect(query.gmailraw).toContain('newer_than:45d')
    expect(query.gmailraw).toContain('has:attachment')
  })

  it('gmail host appends SCAN_GMAIL_QUERY_EXTRA when set', async () => {
    await setSetting('scan_gmail_query_extra', '-in:spam -in:trash')
    const provider = new GmailImapProvider({ host: 'imap.gmail.com', port: 993, user: 'me@gmail.com', password: 'pw' })
    await provider.withSession((session) => session.search(criteria))

    const [query] = searchMock.mock.calls[0]
    expect(query.gmailraw.endsWith('-in:spam -in:trash')).toBe(true)
  })

  it('*.gmail.com subdomain host is also treated as gmail', async () => {
    const provider = new GmailImapProvider({ host: 'imap.mail.gmail.com', port: 993, user: 'me@gmail.com', password: 'pw' })
    await provider.withSession((session) => session.search(criteria))

    const [query] = searchMock.mock.calls[0]
    expect(typeof query.gmailraw).toBe('string')
    expect(query.gmailraw).toContain('from:(hsbc@bank.com) OR from:(esunbank@esunbank.com.tw)')
    expect(query.gmailraw).toContain('newer_than:45d')
  })

  it('non-gmail host (imap.fastmail.com): builds a structured query with since + or-from, no gmailraw string', async () => {
    const before = Date.now()
    const provider = new GmailImapProvider({ host: 'imap.fastmail.com', port: 993, user: 'me@fastmail.com', password: 'pw' })
    await provider.withSession((session) => session.search(criteria))

    const [query, opts] = searchMock.mock.calls[0]
    expect(opts).toEqual({ uid: true })
    expect(query).not.toHaveProperty('gmailraw')
    expect(query.since).toBeInstanceOf(Date)
    const expectedSinceMs = before - 45 * 24 * 60 * 60 * 1000
    expect(Math.abs(query.since.getTime() - expectedSinceMs)).toBeLessThan(5000)
    expect(query.or).toEqual([{ from: 'hsbc@bank.com' }, { from: 'esunbank@esunbank.com.tw' }])
    // hasAttachment has no standard IMAP criterion — must not leak into the query object
    expect(query).not.toHaveProperty('hasAttachment')
  })

  it('non-gmail host with a single sender uses `from` directly instead of a 1-element `or`', async () => {
    const provider = new GmailImapProvider({ host: 'imap.fastmail.com', port: 993, user: 'me@fastmail.com', password: 'pw' })
    await provider.withSession((session) => session.search({ senders: ['only@bank.com'], sinceDays: 30, hasAttachment: true }))

    const [query] = searchMock.mock.calls[0]
    expect(query.from).toBe('only@bank.com')
    expect(query).not.toHaveProperty('or')
  })

  it('non-gmail host ignores SCAN_GMAIL_QUERY_EXTRA (Gmail-only syntax) yet still builds a correct structured query', async () => {
    await setSetting('scan_gmail_query_extra', '-in:spam')
    const provider = new GmailImapProvider({ host: 'imap.fastmail.com', port: 993, user: 'me@fastmail.com', password: 'pw' })
    await provider.withSession((session) => session.search(criteria))

    const [query] = searchMock.mock.calls[0]
    expect(JSON.stringify(query)).not.toContain('-in:spam')
    // Not just "extra text is absent" — confirm the query is still correctly built,
    // i.e. this isn't vacuously true from an empty/broken query object.
    expect(query.since).toBeInstanceOf(Date)
    expect(query.or).toEqual([{ from: 'hsbc@bank.com' }, { from: 'esunbank@esunbank.com.tw' }])
  })

  it('gmail host session exposes searchRaw using the raw gmailraw extension (debug escape hatch)', async () => {
    const provider = new GmailImapProvider({ host: 'imap.gmail.com', port: 993, user: 'me@gmail.com', password: 'pw' })
    await provider.withSession(async (session) => {
      expect(typeof session.searchRaw).toBe('function')
      await session.searchRaw?.('newer_than:7d has:attachment')
    })
    const [query] = searchMock.mock.calls[0]
    expect(query).toEqual({ gmailraw: 'newer_than:7d has:attachment' })
  })

  it('non-gmail host session does not expose searchRaw (no Gmail-only extension to call)', async () => {
    const provider = new GmailImapProvider({ host: 'imap.fastmail.com', port: 993, user: 'me@fastmail.com', password: 'pw' })
    await provider.withSession(async (session) => {
      expect(session.searchRaw).toBeUndefined()
    })
  })
})
