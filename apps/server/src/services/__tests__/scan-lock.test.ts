import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setupTestDb } from './helpers/test-db.js'

setupTestDb()
process.env.LOG_LEVEL = 'silent'

function createDeferred<T = void>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => { resolve = res })
  return { promise, resolve }
}

// Fake EmailSession/EmailProvider so scanAndProcessEmails reaches
// provider.withSession() -> session.search() and we can hang it mid-flight
// on a Deferred we control, to simulate a long-running scan.
const fakeSession = {
  search: vi.fn(async (): Promise<{ id: string }[]> => []),
  fetch: vi.fn(async () => null),
}

const fakeProvider = {
  name: 'gmail-imap',
  verify: vi.fn(async () => ({ ok: true, email: 'me@example.com' })),
  withSession: vi.fn(async (fn: (s: typeof fakeSession) => unknown) => fn(fakeSession)),
  fetchOne: vi.fn(async () => null),
}

vi.mock('@/services/email/index.js', () => ({
  getEmailProviderFor: () => fakeProvider,
}))

const { default: prisma } = await import('@/prisma.js')
const { runScanWithLog, ScanInProgressError } = await import('../email-parser.js')

let userSeq = 0

async function seedScanUser() {
  userSeq += 1
  const user = await prisma.user.create({
    data: { username: `lock-user-${userSeq}`, passwordHash: 'x:y', role: 'member' },
  })
  // scanAndProcessEmails returns early (before touching the provider) when a
  // user has no active banks, so every lock test needs at least one.
  await prisma.bank.create({
    data: { name: 'lock-bank', emailSenderPattern: 'x@x', emailSubjectPattern: 'bill', userId: user.id },
  })
  return user
}

describe('runScanWithLog: per-user scan mutex', () => {
  beforeEach(() => {
    fakeSession.search.mockReset()
    fakeSession.search.mockResolvedValue([])
  })

  it('rejects a concurrent scan for the SAME user without creating a ScanLog row; a DIFFERENT user is unaffected; the lock releases on completion so a follow-up scan succeeds', async () => {
    const userA = await seedScanUser()
    const userB = await seedScanUser()

    const countBefore = await prisma.scanLog.count()

    const deferred = createDeferred<void>()
    fakeSession.search.mockImplementation(async () => {
      await deferred.promise
      return []
    })

    // userA's scan starts and hangs mid-flight inside withSession -> search.
    const p1 = runScanWithLog('manual', userA)

    // A concurrent scan for the SAME user must be rejected while p1 is still
    // in-flight, and must NOT create a dangling ScanLog row.
    await expect(runScanWithLog('manual', userA)).rejects.toThrow(ScanInProgressError)

    // A DIFFERENT user must never be blocked by userA's in-flight scan.
    const p2 = runScanWithLog('manual', userB)

    // Let both in-flight scans finish.
    deferred.resolve()
    const [scanA1, scanB] = await Promise.all([p1, p2])
    expect(scanA1.result.errors).toEqual([])
    expect(scanB.result.errors).toEqual([])

    // Lock released in `finally`: userA can scan again immediately.
    const scanA2 = await runScanWithLog('manual', userA)
    expect(scanA2.result.errors).toEqual([])

    // Exactly 3 ScanLog rows were created across this test (p1, p2, scanA2) —
    // the rejected concurrent attempt for userA created none.
    expect(await prisma.scanLog.count()).toBe(countBefore + 3)
  }, 2000) // short timeout: pre-lock this hangs (blocks on the shared deferred) instead of rejecting fast

  it('releases the lock via finally even when the scan crashes unexpectedly, so the user is not wedged out permanently', async () => {
    const userA = await seedScanUser()
    const createSpy = vi.spyOn(prisma.scanLog, 'create').mockRejectedValueOnce(new Error('db boom'))

    await expect(runScanWithLog('manual', userA)).rejects.toThrow('db boom')
    createSpy.mockRestore()

    // Not wedged: a normal follow-up scan for the same user succeeds.
    const { result } = await runScanWithLog('manual', userA)
    expect(result.errors).toEqual([])
  })
})
