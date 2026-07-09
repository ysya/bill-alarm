import { describe, it, expect, vi } from 'vitest'
import { setupTestDb } from '../../services/__tests__/helpers/test-db.js'

setupTestDb()
process.env.LOG_LEVEL = 'silent'

const verifyConnectionForMock = vi.fn(async () => ({
  connected: true,
  message: '已連線：mock@example.com',
  email: 'mock@example.com',
}))

// Mock out the real IMAP probe so tests never hit the network. Spread the actual
// module so unrelated exports (e.g. getEmailProviderFor, used by other routes
// loaded as part of the app) keep working normally.
vi.mock('@/services/email/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/email/index.js')>()
  return { ...actual, verifyConnectionFor: verifyConnectionForMock }
})

const { default: app } = await import('@/index.js')
const { default: prisma } = await import('@/prisma.js')

function cookieOf(res: Response): string {
  return res.headers.get('set-cookie')?.split(';')[0] ?? ''
}

const setup = await app.request('/api/auth/setup', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'boss', password: 'admin-password' }),
})
const cookie = cookieOf(setup)

describe('GET /api/email/status serves the per-user (rich) handler', () => {
  it('returns the hasCredentials shape, not the slim system.ts shadow', async () => {
    const res = await app.request('/api/email/status', { headers: { Cookie: cookie } })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty('hasCredentials')
    expect(body.hasCredentials).toBe(false) // no imap configured yet
    expect(body).toHaveProperty('host') // richer shape includes host/port/user
  })
})

describe('GET /api/email/status is lazy by default, only probes IMAP with ?verify=1', () => {
  it('with credentials configured, the default call does NOT invoke verifyConnectionFor and omits connected/message/email', async () => {
    const user = await prisma.user.findUnique({ where: { username: 'boss' } })
    await prisma.user.update({
      where: { id: user!.id },
      data: { imapHost: 'imap.gmail.com', imapPort: 993, imapUser: 'me@gmail.com', imapPassword: 'app-password' },
    })
    verifyConnectionForMock.mockClear()

    const res = await app.request('/api/email/status', { headers: { Cookie: cookie } })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ hasCredentials: true, host: 'imap.gmail.com', port: 993, user: 'me@gmail.com' })
    expect(verifyConnectionForMock).not.toHaveBeenCalled()
  })

  it('?verify=1 calls verifyConnectionFor once and adds connected/message/email', async () => {
    verifyConnectionForMock.mockClear()

    const res = await app.request('/api/email/status?verify=1', { headers: { Cookie: cookie } })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({
      hasCredentials: true,
      connected: true,
      message: '已連線：mock@example.com',
      email: 'mock@example.com',
    })
    expect(verifyConnectionForMock).toHaveBeenCalledTimes(1)
  })
})
