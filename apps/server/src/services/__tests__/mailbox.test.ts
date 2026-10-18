import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { setupTestDb } from './helpers/test-db.js'
import type { SearchCriteria } from '../email/types.js'

const { searchMock, imapFlowConstructorSpy, listMock, mailboxLockMock, fetchOneMock, releaseMock, logoutMock } = vi.hoisted(() => ({
  // Typed via the generic param (not a named-arg implementation) so the mock
  // records `client.search(query, options)` calls without unused-param lint noise.
  searchMock: vi.fn<(query: any, options?: any) => Promise<number[] | false>>(),
  // Captures the ImapFlowOptions each `new ImapFlow(...)` call receives, so
  // tests can assert exactly what `auth.pass` reached the wire — the only
  // way to prove getEmailProviderFor decrypted the password rather than
  // merely "didn't crash".
  imapFlowConstructorSpy: vi.fn<(options: unknown) => void>(),
  listMock: vi.fn(async () => [{ path: '[Gmail]/所有郵件', specialUse: '\\All' }]),
  mailboxLockMock: vi.fn<(path: string, options?: unknown) => void>(),
  fetchOneMock: vi.fn(),
  releaseMock: vi.fn(),
  logoutMock: vi.fn(async () => {}),
}))

vi.mock('imapflow', () => ({
  // Must be a real class (not an arrow fn) — gmail-imap.ts calls `new ImapFlow(...)`.
  ImapFlow: class {
    constructor(public options: unknown) {
      imapFlowConstructorSpy(options)
    }
    connect = vi.fn(async () => {})
    logout = logoutMock
    list = listMock
    getMailboxLock = vi.fn(async (path: string, options?: unknown) => {
      mailboxLockMock(path, options)
      return { release: releaseMock, path }
    })
    search = searchMock
    fetchOne = fetchOneMock
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
const { encryptSecret } = await import('../secrets.js')

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

describe('Gmail archived mail', () => {
  const config = { host: 'imap.gmail.com', port: 993, user: 'me@gmail.com', password: 'pw' }
  const criteria: SearchCriteria = { senders: ['cards@estatements.hsbc.com.tw'], sinceDays: 30, hasAttachment: true }
  const source = Buffer.from('From: cards@estatements.hsbc.com.tw\r\nSubject: October statement\r\n\r\nArchived bill')

  beforeEach(() => {
    searchMock.mockReset().mockResolvedValue([7])
    listMock.mockReset().mockResolvedValue([
      { path: 'INBOX', specialUse: '\\Inbox' },
      { path: '[Gmail]/所有郵件', specialUse: '\\All' },
    ])
    mailboxLockMock.mockClear()
    fetchOneMock.mockReset().mockResolvedValue({ uid: 7, seq: 1, source })
    releaseMock.mockClear()
    logoutMock.mockClear()
  })

  it('finds and fetches an archived statement from the localized All Mail folder', async () => {
    // Reverting to INBOX must make the archived statement disappear.
    searchMock.mockImplementation(async () => (
      mailboxLockMock.mock.lastCall?.[0] === '[Gmail]/所有郵件' ? [7] : []
    ))
    const provider = new GmailImapProvider(config)
    await provider.withSession(async (session) => {
      const refs = await session.search(criteria)
      expect(refs).toEqual([{ id: 'gmail-all:7' }])
      expect((await session.fetch(refs[0]))?.subject).toBe('October statement')
    })
    expect(mailboxLockMock).toHaveBeenCalledWith('[Gmail]/所有郵件', { readOnly: true })
    expect(fetchOneMock).toHaveBeenCalledWith('7', { source: true }, { uid: true })
    expect(releaseMock).toHaveBeenCalledOnce()
    expect(logoutMock).toHaveBeenCalledOnce()
  })

  it('uses the same scoped IDs for raw debug search and one-off attachment lookups', async () => {
    const provider = new GmailImapProvider(config)
    const refs = await provider.withSession((session) => session.searchRaw!('from:hsbc newer_than:30d'))
    expect(refs).toEqual([{ id: 'gmail-all:7' }])
    const email = await provider.fetchOne(refs[0].id)
    expect(email?.id).toBe('gmail-all:7')
    expect(email?.subject).toBe('October statement')
    expect(mailboxLockMock.mock.calls.map(([path]) => path)).toEqual(['[Gmail]/所有郵件', '[Gmail]/所有郵件'])
  })

  it('does not confuse an All Mail UID with an old INBOX bill having the same UID', async () => {
    const { emailAlreadyProcessed, duplicateBillExists } = await import('../email-parser.js')
    const user = await prisma.user.create({ data: { username: 'archive-owner', passwordHash: 'x:y' } })
    const bank = await prisma.bank.create({
      data: { name: 'HSBC', emailSenderPattern: criteria.senders[0], emailSubjectPattern: 'statement', userId: user.id },
    })
    await prisma.bill.create({
      data: { bankId: bank.id, billingPeriod: '2026-09', amount: 1604, dueDate: '2026-09-21', sourceEmailId: '7' },
    })

    const refs = await new GmailImapProvider(config).withSession((session) => session.search(criteria))
    expect(await emailAlreadyProcessed(refs[0].id, user.id)).toBe(false)
    // Existing statement-level dedup still protects bills re-found in All Mail.
    expect(await duplicateBillExists(bank.id, 1604, '2026-09-21')).toBe(true)
  })

  it('keeps legacy unprefixed Gmail lookups in INBOX', async () => {
    fetchOneMock.mockImplementation(async () => ({
      uid: 7,
      seq: 1,
      source: Buffer.from(`Subject: ${mailboxLockMock.mock.lastCall?.[0] === 'INBOX' ? 'September' : 'October'} statement\r\n\r\nBill`),
    }))
    const email = await new GmailImapProvider(config).fetchOne('7')
    expect(email?.id).toBe('7')
    expect(email?.subject).toBe('September statement')
    expect(mailboxLockMock).toHaveBeenCalledWith('INBOX', { readOnly: true })
    expect(listMock).not.toHaveBeenCalled()
  })

  it('keeps non-Gmail searches and IDs in INBOX', async () => {
    const provider = new GmailImapProvider({ ...config, host: 'imap.fastmail.com' })
    const refs = await provider.withSession((session) => session.search(criteria))
    expect(refs).toEqual([{ id: '7' }])
    expect(mailboxLockMock).toHaveBeenCalledWith('INBOX', { readOnly: true })
    expect(listMock).not.toHaveBeenCalled()
  })

  it('returns no refs when IMAP search returns false', async () => {
    searchMock.mockResolvedValue(false)
    const refs = await new GmailImapProvider(config).withSession((session) => session.search(criteria))
    expect(refs).toEqual([])
  })

  it('reports unavailable All Mail instead of silently missing archived bills, and logs out', async () => {
    listMock.mockResolvedValue([{ path: 'INBOX', specialUse: '\\Inbox' }])
    await expect(new GmailImapProvider(config).withSession((session) => session.search(criteria)))
      .rejects.toThrow('Gmail All Mail')
    expect(searchMock).not.toHaveBeenCalled()
    expect(logoutMock).toHaveBeenCalledOnce()
  })
})

// getEmailProviderFor is the single choke point every mailbox use goes
// through (routes/email.ts, routes/parser-lab.ts, services/email-parser.ts),
// so decrypting there — rather than at each call site — covers all of them.
describe('secrets: getEmailProviderFor decrypts imapPassword (read choke point)', () => {
  let originalKey: string | undefined

  beforeEach(() => {
    originalKey = process.env.ENCRYPTION_KEY
    imapFlowConstructorSpy.mockClear()
  })

  afterEach(() => {
    if (originalKey === undefined) delete process.env.ENCRYPTION_KEY
    else process.env.ENCRYPTION_KEY = originalKey
  })

  it('an enc:v1: imapPassword is decrypted before reaching the IMAP client', async () => {
    process.env.ENCRYPTION_KEY = 'mailbox-decrypt-test-key'
    const stored = encryptSecret('real-mailbox-password-999')
    expect(stored.startsWith('enc:v1:')).toBe(true)

    const provider = getEmailProviderFor({ imapHost: 'imap.gmail.com', imapPort: 993, imapUser: 'me@gmail.com', imapPassword: stored })
    expect(provider).not.toBeNull()
    await provider!.verify()

    expect(imapFlowConstructorSpy).toHaveBeenCalledTimes(1)
    const [opts] = imapFlowConstructorSpy.mock.calls[0]
    expect((opts as { auth: { pass: string } }).auth.pass).toBe('real-mailbox-password-999')
  })

  it('a legacy plaintext imapPassword (no enc:v1: prefix) still reaches the IMAP client unchanged, even with a key configured', async () => {
    process.env.ENCRYPTION_KEY = 'mailbox-decrypt-test-key-2'

    const provider = getEmailProviderFor({ imapHost: 'imap.gmail.com', imapPort: 993, imapUser: 'me@gmail.com', imapPassword: 'legacy-plaintext-pw' })
    await provider!.verify()

    const [opts] = imapFlowConstructorSpy.mock.calls[0]
    expect((opts as { auth: { pass: string } }).auth.pass).toBe('legacy-plaintext-pw')
  })

  it('an enc:v1: imapPassword with no ENCRYPTION_KEY configured throws eagerly (misconfiguration), instead of leaking ciphertext to the IMAP client', async () => {
    process.env.ENCRYPTION_KEY = 'mailbox-decrypt-test-key-3'
    const stored = encryptSecret('will-lose-the-key-next')
    delete process.env.ENCRYPTION_KEY

    // Decryption happens while constructing the provider (getEmailProviderFor
    // is the choke point), so the throw surfaces from this call itself — not
    // deferred to a later verify()/withSession() call.
    expect(() => getEmailProviderFor({ imapHost: 'imap.gmail.com', imapPort: 993, imapUser: 'me@gmail.com', imapPassword: stored })).toThrow()
    expect(imapFlowConstructorSpy).not.toHaveBeenCalled()
  })
})
