import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, it, expect, vi, afterAll } from 'vitest'
import { setupTestDb } from './helpers/test-db.js'
import { todayYMD, addDaysYMD } from '@bill-alarm/shared/date'
import type { EmailMessage, EmailProvider, EmailSession, MessageRef, SearchCriteria } from '../email/types.js'
import type { ScanEvent } from '@bill-alarm/shared/scan'

// MT-cycle carry-forward (Plan B Task 16): the multi-tenant cycle left these
// scan-path isolation properties "correct by inspection" but with NO
// integration test — this file pins them end-to-end with a real
// scanAndProcessEmails/runScanWithLog run (prisma unmocked), not synthetic
// state:
//   (a) scanAndProcessEmails(userA) only ever queries/touches userA's own
//       banks + mailbox — userB's bank/mailbox/bills are untouched.
//   (b) runScanWithLog stamps ScanLog.userId with the scanning user.
//   (c) scanEvents' eventVisibleTo() + per-user snapshot Map (B4) keep
//       userA's scan invisible to userB, including under real concurrency.

// email-parser.ts writes newly-created bills' PDFs under PDF_DIR, which is
// derived from DATA_DIR at import time — must be redirected to a throwaway
// temp dir BEFORE the first import that pulls in '@/paths.js' (mirrors
// bills-pdf.test.ts), or this test would write files into the real project
// data/ directory.
const previousDataDir = process.env.DATA_DIR
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bill-alarm-scan-isolation-test-'))
process.env.DATA_DIR = dataDir

setupTestDb()
process.env.LOG_LEVEL = 'silent'

afterAll(() => {
  fs.rmSync(dataDir, { recursive: true, force: true })
  if (previousDataDir === undefined) delete process.env.DATA_DIR
  else process.env.DATA_DIR = previousDataDir
})

// Per-user fake EmailProvider registry so getEmailProviderFor(user) returns
// ONLY that user's own mailbox. This mock is what makes a scoping leak
// observable (a provider's spies fire when they shouldn't) — the isolation
// itself must come from scanAndProcessEmails's own `where: { userId }` bank
// query, which is real prisma, not mocked here.
const { emailProviders } = vi.hoisted(() => ({
  emailProviders: new Map<string, EmailProvider>(),
}))

vi.mock('@/services/email/index.js', () => ({
  getEmailProviderFor: (owner: { id: string }) => emailProviders.get(owner.id) ?? null,
}))

// Bypass real mupdf PDF parsing (a heavy binary dependency unrelated to what
// this file pins) the same way other tests bypass IMAP/LLM at their module
// boundary: getPdfBuffers just forwards the attachment bytes, and
// extractPdfText treats them as already-decoded UTF-8 text. The fake emails
// below embed a parserConfig-matchable text directly as attachment.data.
vi.mock('@/services/pdf-parser.js', () => ({
  getPdfBuffers: vi.fn(async (attachments: { data: Buffer }[]) => attachments.map((a) => a.data)),
  extractPdfText: vi.fn(async (buf: Buffer) => buf.toString('utf-8')),
}))

const { default: prisma } = await import('@/prisma.js')
const { default: app } = await import('@/index.js')
const { createSession } = await import('../auth.js')
const { runScanWithLog } = await import('../email-parser.js')
const { scanEvents, eventVisibleTo } = await import('../scan-events.js')

// Resolves the next bus event matching `predicate`, then detaches itself.
// Used to deterministically observe scanEvents/getSnapshot state at an exact
// point during a real, in-flight scan instead of guessing with timers.
function waitForScanEvent(predicate: (e: ScanEvent) => boolean): Promise<ScanEvent> {
  return new Promise((resolve) => {
    const listener = (e: ScanEvent) => {
      if (predicate(e)) {
        scanEvents.off('scan', listener)
        resolve(e)
      }
    }
    scanEvents.on('scan', listener)
  })
}

function createDeferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => { resolve = res })
  return { promise, resolve }
}

// Template-parser config (see bill-parser.test.ts for the same style):
// matches "應繳金額 <n>" for amount and "繳款截止日：YYYY/MM/DD" for dueDate,
// no LLM/hardcoded parser or real PDF bytes required.
const TEMPLATE_CONFIG = JSON.stringify({
  amount: { keyword: '應繳金額', type: 'amount', nth: 1 },
  dueDate: { keyword: '繳款截止日', type: 'adDate', nth: 1 },
})

function billText(amount: number, dueDateYMD: string): string {
  return `應繳金額 ${amount}\n繳款截止日：${dueDateYMD.replaceAll('-', '/')}`
}

function fakeEmail(id: string, from: string, subject: string, pdfText: string): EmailMessage {
  return {
    id,
    subject,
    from,
    date: new Date(),
    text: '',
    html: '',
    snippet: '',
    attachments: [{ filename: 'statement.pdf', contentType: 'application/pdf', data: Buffer.from(pdfText, 'utf-8') }],
  }
}

/** Build a fake EmailProvider whose session.search/fetch are directly-inspectable vi.fn mocks. */
function buildFakeProvider(searchResult: MessageRef[], fetchImpl: () => Promise<EmailMessage | null>, mailboxKey?: string) {
  const searchFn = vi.fn<(criteria: SearchCriteria) => Promise<MessageRef[]>>()
  searchFn.mockResolvedValue(searchResult)
  const fetchFn = vi.fn<(ref: MessageRef) => Promise<EmailMessage | null>>()
  fetchFn.mockImplementation(fetchImpl)
  const session: EmailSession = { search: searchFn, fetch: fetchFn, mailboxKey }
  const provider: EmailProvider = {
    name: 'gmail-imap',
    verify: vi.fn(async () => ({ ok: true, email: 'fake@example.com' })),
    withSession: vi.fn(async (fn) => fn(session)),
    fetchOne: vi.fn(async () => null),
  }
  return { provider, searchFn, fetchFn }
}

describe('scan isolation (MT carry-forward): a real scan for userA touches only userA data end-to-end', () => {
  it('creates the bill only under userA\'s own bank, stamps ScanLog.userId = userA, and every bus event from the scan is tagged/visible to userA only — userB\'s mailbox, bills, ScanLog and SSE events are all untouched', async () => {
    const userA = await prisma.user.create({ data: { username: 'iso-user-a', passwordHash: 'x:y', role: 'member' } })
    const userB = await prisma.user.create({ data: { username: 'iso-user-b', passwordHash: 'x:y', role: 'member' } })

    const bankA = await prisma.bank.create({
      data: {
        name: 'A 銀行',
        emailSenderPattern: 'estatement@usera-bank.example.com',
        emailSubjectPattern: 'BillNoticeA',
        parserConfig: TEMPLATE_CONFIG,
        userId: userA.id,
      },
    })
    const bankB = await prisma.bank.create({
      data: {
        name: 'B 銀行',
        emailSenderPattern: 'estatement@userb-bank.example.com',
        emailSubjectPattern: 'BillNoticeB',
        parserConfig: TEMPLATE_CONFIG,
        userId: userB.id,
      },
    })

    const dueDateA = addDaysYMD(todayYMD(), 20)
    const emailA = fakeEmail(
      'emailA-1',
      `A Bank <${bankA.emailSenderPattern}>`,
      'BillNoticeA - July statement',
      billText(12345, dueDateA),
    )
    const emailB = fakeEmail(
      'emailB-1',
      `B Bank <${bankB.emailSenderPattern}>`,
      'BillNoticeB - July statement',
      billText(54321, addDaysYMD(todayYMD(), 25)),
    )

    const { provider: providerA, searchFn: searchA } = buildFakeProvider([{ id: emailA.id }], async () => emailA)
    const { provider: providerB, searchFn: searchB, fetchFn: fetchB } = buildFakeProvider([{ id: emailB.id }], async () => emailB)
    emailProviders.set(userA.id, providerA)
    emailProviders.set(userB.id, providerB)

    // Mirrors routes/scan.ts's real SSE listener shape: collect every raw bus
    // event emitted during userA's scan, unfiltered, so we can check both
    // that every event really is tagged with userA's id AND that
    // eventVisibleTo agrees on every one of them (not just a synthetic sample).
    const allEvents: ScanEvent[] = []
    const listener = (e: ScanEvent) => allEvents.push(e)
    scanEvents.on('scan', listener)

    const recorded = await runScanWithLog('manual', userA).finally(() => {
      scanEvents.off('scan', listener)
    })

    // --- (a) scanAndProcessEmails(userA) only ever touches userA's bank/mailbox ---
    expect(searchA).toHaveBeenCalledTimes(1)
    expect(searchA.mock.calls[0][0].senders).toEqual([bankA.emailSenderPattern])
    expect(providerB.withSession).not.toHaveBeenCalled()
    expect(searchB).not.toHaveBeenCalled()
    expect(fetchB).not.toHaveBeenCalled()

    expect(recorded.result.errors).toEqual([])
    expect(recorded.result.newBills).toHaveLength(1)
    expect(recorded.result.newBills[0].bank.id).toBe(bankA.id)

    const billsA = await prisma.bill.findMany({ where: { bank: { userId: userA.id } } })
    const billsB = await prisma.bill.findMany({ where: { bank: { userId: userB.id } } })
    expect(billsA).toHaveLength(1)
    expect(billsA[0].bankId).toBe(bankA.id)
    expect(billsA[0].amount).toBe(12345)
    expect(billsA[0].dueDate).toBe(dueDateA)
    expect(billsB).toHaveLength(0)

    // --- (b) runScanWithLog stamps ScanLog.userId with the scanning user ---
    const scanLog = await prisma.scanLog.findUniqueOrThrow({ where: { id: recorded.scanLogId } })
    expect(scanLog.userId).toBe(userA.id)
    expect(scanLog.trigger).toBe('manual')
    const scanLogsForB = await prisma.scanLog.findMany({ where: { userId: userB.id } })
    expect(scanLogsForB).toHaveLength(0)

    // --- (c) SSE: every event from userA's scan is visible to A, none to B ---
    expect(allEvents.length).toBeGreaterThanOrEqual(3) // start + >=1 progress + complete
    expect(allEvents.every((e) => e.userId === userA.id)).toBe(true)
    for (const e of allEvents) {
      expect(eventVisibleTo(e, userA.id)).toBe(true)
      expect(eventVisibleTo(e, userB.id)).toBe(false)
    }
  })
})

describe('scan isolation (MT carry-forward): concurrent real scans for two different users never cross-contaminate the SSE snapshot Map or bus events', () => {
  it('while userC\'s scan is still in flight (hung mid-fetch), userD independently starts and completes their own scan — neither user\'s snapshot or events ever leak to the other', async () => {
    const userC = await prisma.user.create({ data: { username: 'iso-user-c', passwordHash: 'x:y', role: 'member' } })
    const userD = await prisma.user.create({ data: { username: 'iso-user-d', passwordHash: 'x:y', role: 'member' } })
    await prisma.bank.create({
      data: { name: 'C 銀行', emailSenderPattern: 'c@bank.example.com', emailSubjectPattern: 'BillC', userId: userC.id },
    })
    await prisma.bank.create({
      data: { name: 'D 銀行', emailSenderPattern: 'd@bank.example.com', emailSubjectPattern: 'BillD', userId: userD.id },
    })

    const eventsVisibleToC: ScanEvent[] = []
    const eventsVisibleToD: ScanEvent[] = []
    const listener = (e: ScanEvent) => {
      if (eventVisibleTo(e, userC.id)) eventsVisibleToC.push(e)
      if (eventVisibleTo(e, userD.id)) eventsVisibleToD.push(e)
    }
    scanEvents.on('scan', listener)

    try {
      // userC has exactly one message to process, but fetching it hangs on a
      // deferred we control — so userC's scan is genuinely "in flight" (past
      // its 'start' event, before 'complete') for as long as we need.
      const fetchGate = createDeferred<EmailMessage | null>()
      const { provider: providerC } = buildFakeProvider([{ id: 'gmail-all:42' }], () => fetchGate.promise, 'folder-c')
      // userD has nothing to process — its scan runs start -> complete immediately.
      const { provider: providerD } = buildFakeProvider([], async () => null)
      emailProviders.set(userC.id, providerC)
      emailProviders.set(userD.id, providerD)

      const cStartEventPromise = waitForScanEvent((e) => e.type === 'start' && e.userId === userC.id)
      const scanCPromise = runScanWithLog('manual', userC)
      const cStartEvent = (await cStartEventPromise) as Extract<ScanEvent, { type: 'start' }>

      // userC's scan has started (and is now hung inside session.fetch): its
      // snapshot must exist, keyed only to userC — userD hasn't scanned yet.
      expect(scanEvents.getSnapshot(userC.id)?.start.scanLogId).toBe(cStartEvent.scanLogId)
      expect(scanEvents.getSnapshot(userD.id)).toBeNull()

      // userD scans to completion WHILE userC is still hung mid-flight.
      const scanD = await runScanWithLog('manual', userD)
      expect(scanD.result.errors).toEqual([])

      // userD's own scan completed and cleared ONLY userD's snapshot; userC's
      // in-flight snapshot is untouched by userD's start+complete in between.
      expect(scanEvents.getSnapshot(userD.id)).toBeNull()
      expect(scanEvents.getSnapshot(userC.id)?.start.scanLogId).toBe(cStartEvent.scanLogId)

      // Let userC finish.
      fetchGate.resolve(null)
      const scanC = await scanCPromise
      expect(scanC.result.errors).toMatchObject([{ stage: 'email_fetch', msgId: 'gmail-all:42', mailboxKey: 'folder-c' }])
      const headers = { Cookie: `ba_session=${(await createSession(userC.id)).token}` }
      const userLogs = await (await app.request('/api/scan-logs', { headers })).json()
      expect(userLogs.logs[0]).toMatchObject({
        id: scanC.scanLogId, errorCount: 1, errors: [{ stage: 'email_fetch', canRetry: true, msgId: 'gmail-all:42' }],
      })
      expect(eventsVisibleToC).toContainEqual(expect.objectContaining({ type: 'progress', status: 'error' }))

      expect(scanEvents.getSnapshot(userC.id)).toBeNull()
      expect(scanEvents.getSnapshot(userD.id)).toBeNull()

      // Across the whole overlapping run, a listener filtered by
      // eventVisibleTo for one user never received an event tagged for the
      // other — the concurrency itself never leaked anything cross-user.
      expect(eventsVisibleToC.length).toBeGreaterThan(0)
      expect(eventsVisibleToD.length).toBeGreaterThan(0)
      expect(eventsVisibleToC.every((e) => e.userId === userC.id)).toBe(true)
      expect(eventsVisibleToD.every((e) => e.userId === userD.id)).toBe(true)
    } finally {
      scanEvents.off('scan', listener)
    }
  })
})

describe('single-message recovery', () => {
  it('retries the recorded owner and UID only, after the PDF password is fixed, while preserving the scan lock and deduplication', async () => {
    const owner = await prisma.user.create({ data: { username: 'retry-owner', passwordHash: 'x:y' } })
    const other = await prisma.user.create({ data: { username: 'retry-other', passwordHash: 'x:y' } })
    const ownerCookie = { Cookie: `ba_session=${(await createSession(owner.id)).token}` }
    const otherCookie = { Cookie: `ba_session=${(await createSession(other.id)).token}` }
    const bank = await prisma.bank.create({
      data: { name: 'Retry bank', emailSenderPattern: 'retry@example.com', emailSubjectPattern: 'Statement', userId: owner.id, parserConfig: TEMPLATE_CONFIG, autoDebit: true },
    })
    const email = fakeEmail('gmail-all:77', bank.emailSenderPattern, 'Statement', billText(98, addDaysYMD(todayYMD(), 12)))
    const mailbox = buildFakeProvider([{ id: email.id }], async () => email, 'folder-one')
    emailProviders.set(owner.id, mailbox.provider)
    const { extractPdfText } = await import('../pdf-parser.js')
    vi.mocked(extractPdfText).mockRejectedValueOnce(new Error('PDF 密碼錯誤'))
    const failed = await runScanWithLog('manual', owner)
    const logs = await (await app.request('/api/scan-logs', { headers: ownerCookie })).json()
    const error = logs.logs[0].errors[0]
    expect(error).toMatchObject({ stage: 'pdf_password', bankId: bank.id, msgId: email.id, canRetry: true })
    expect(error).not.toHaveProperty('mailboxKey')
    const retryUrl = `/api/scan-logs/${failed.scanLogId}/errors/0/retry`
    expect((await app.request(retryUrl, { method: 'POST', headers: otherCookie })).status).toBe(404)

    const differentMailbox = buildFakeProvider([], async () => email, 'folder-two')
    emailProviders.set(owner.id, differentMailbox.provider)
    const mismatch = await app.request(retryUrl, { method: 'POST', headers: ownerCookie })
    expect((await mismatch.json()).errors[0]).toMatchObject({ stage: 'email_fetch', canRetry: false })
    expect(differentMailbox.fetchFn).not.toHaveBeenCalled()
    expect(differentMailbox.searchFn).not.toHaveBeenCalled()

    emailProviders.set(owner.id, mailbox.provider)
    const update = await app.request(`/api/banks/${bank.id}`, {
      method: 'PATCH', headers: { ...ownerCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ pdfPassword: 'corrected-password' }),
    })
    expect(update.status).toBe(200)
    const gate = createDeferred<EmailMessage | null>()
    mailbox.fetchFn.mockClear().mockImplementationOnce(() => gate.promise)
    const start = waitForScanEvent(e => e.userId === owner.id && e.type === 'start' && e.trigger === 'retry')
    const retry = app.request(retryUrl, { method: 'POST', headers: ownerCookie })
    await start
    try {
      expect((await app.request('/api/email/scan', { method: 'POST', headers: ownerCookie })).status).toBe(409)
    } finally {
      gate.resolve(email)
    }
    const recovered = await (await retry).json()
    expect(recovered).toMatchObject({ scanned: 1, newBills: 1, errors: [] })
    expect(mailbox.fetchFn.mock.calls).toEqual([[{ id: email.id }]])
    expect(extractPdfText).toHaveBeenLastCalledWith(email.attachments[0].data, 'corrected-password')
    expect(await prisma.scanLog.findUnique({ where: { id: recovered.scanLogId } })).toMatchObject({ userId: owner.id, trigger: 'retry', newBillsCount: 1 })

    const repeated = await app.request(retryUrl, { method: 'POST', headers: ownerCookie })
    expect(await repeated.json()).toMatchObject({ newBills: 0, errors: [], skipReason: '此信件已建立過帳單' })
    expect(mailbox.fetchFn).toHaveBeenCalledTimes(1)
    expect(mailbox.searchFn).toHaveBeenCalledTimes(1)
    expect(await prisma.bill.count({ where: { bankId: bank.id } })).toBe(1)
  })

  it('keeps historical, non-message and malformed UID errors readable without offering an unsafe retry', async () => {
    const owner = await prisma.user.create({ data: { username: 'legacy-retry-owner', passwordHash: 'x:y' } })
    const headers = { Cookie: `ba_session=${(await createSession(owner.id)).token}` }
    const errors = [
      { stage: 'pdf_password', bank: 'Legacy bank', msgId: '7', reason: 'wrong password' },
      { stage: 'notification', msgId: '7', mailboxKey: 'folder-one', reason: 'notification failed' },
      { stage: 'email_fetch', msgId: '1:*', mailboxKey: 'folder-one', reason: 'invalid UID set' },
    ]
    const log = await prisma.scanLog.create({
      data: { trigger: 'cron', userId: owner.id, errors: JSON.stringify(errors), errorCount: errors.length },
    })
    const body = await (await app.request('/api/scan-logs', { headers })).json()
    expect(body.logs[0].errors.map((error: { canRetry: boolean }) => error.canRetry)).toEqual([false, false, false])
    for (const index of errors.keys()) {
      const response = await app.request(`/api/scan-logs/${log.id}/errors/${index}/retry`, { method: 'POST', headers })
      expect(response.status).toBe(422)
    }
    expect(await prisma.scanLog.count({ where: { userId: owner.id } })).toBe(1)
  })

  it('links a legacy password error only to an unambiguous bank owned by the user that already existed at scan time', async () => {
    const owner = await prisma.user.create({ data: { username: 'legacy-bank-owner', passwordHash: 'x:y' } })
    const other = await prisma.user.create({ data: { username: 'other-bank-owner', passwordHash: 'x:y' } })
    const headers = { Cookie: `ba_session=${(await createSession(owner.id)).token}` }
    const startedAt = new Date('2026-02-10T00:00:00Z')
    const oldBank = { emailSenderPattern: 'bank.example', emailSubjectPattern: 'bill', createdAt: new Date('2026-02-01'), userId: owner.id }
    const unique = await prisma.bank.create({ data: { ...oldBank, name: 'Unique' } })
    await prisma.bank.createMany({ data: [
      { ...oldBank, name: 'Unique', userId: other.id },
      { ...oldBank, name: 'Same' }, { ...oldBank, name: 'Same' },
      { ...oldBank, name: 'Replaced', createdAt: new Date('2026-03-01') },
      { ...oldBank, name: 'Foreign', userId: other.id },
    ] })
    const errors = ['Unique', 'Same', 'Replaced', 'Foreign'].map(bank => ({ stage: 'pdf_password', bank, reason: 'wrong password' }))
    await prisma.scanLog.create({ data: { userId: owner.id, trigger: 'manual', startedAt, errors: JSON.stringify(errors) } })
    const body = await (await app.request('/api/scan-logs', { headers })).json()
    expect(body.logs[0].errors.map((error: { bankId?: string }) => error.bankId)).toEqual([unique.id, undefined, undefined, undefined])
    expect(body.logs[0].errors[0].canRetry).toBe(false)
  })
})
