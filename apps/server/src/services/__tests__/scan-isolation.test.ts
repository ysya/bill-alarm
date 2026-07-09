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
function buildFakeProvider(searchResult: MessageRef[], fetchImpl: () => Promise<EmailMessage | null>) {
  const searchFn = vi.fn<(criteria: SearchCriteria) => Promise<MessageRef[]>>()
  searchFn.mockResolvedValue(searchResult)
  const fetchFn = vi.fn<(ref: MessageRef) => Promise<EmailMessage | null>>()
  fetchFn.mockImplementation(fetchImpl)
  const session: EmailSession = { search: searchFn, fetch: fetchFn }
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
      const { provider: providerC } = buildFakeProvider([{ id: 'emailC-1' }], () => fetchGate.promise)
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
      expect(scanC.result.errors).toEqual([])

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
