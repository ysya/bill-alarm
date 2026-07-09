import { describe, it, expect, vi } from 'vitest'
import { setupTestDb } from '../../services/__tests__/helpers/test-db.js'
import type { EmailMessage, EmailProvider, EmailSession, MessageRef } from '@/services/email/types.js'

setupTestDb()
process.env.LOG_LEVEL = 'silent'

// system.ts's debug routes previously called `provider.search()` / `provider.fetch()`,
// methods that don't exist on EmailProvider (they live on EmailSession, reached via
// withSession, plus the fetchOne(id) convenience). Fake provider below implements the
// REAL interface so these tests fail against the old code (TypeError -> 500) and pass
// once the routes are rewritten to use withSession/fetchOne.
const fakeMessage: EmailMessage = {
  id: 'msg-1',
  subject: 'HSBC 信用卡帳單',
  from: 'estatement@hsbc.com.tw',
  date: new Date('2026-07-01T00:00:00Z'),
  text: 'body text preview',
  html: '<p>body text preview</p>',
  snippet: 'body text preview',
  attachments: [],
}

const fakeSession: EmailSession = {
  search: vi.fn(async (): Promise<MessageRef[]> => [{ id: 'msg-1' }]),
  // Gmail-only debug escape hatch used by GET /api/email/search — see gmail-imap.ts.
  searchRaw: vi.fn(async (): Promise<MessageRef[]> => [{ id: 'msg-1' }]),
  fetch: vi.fn(async () => fakeMessage),
}

const fakeProvider: EmailProvider = {
  name: 'gmail-imap',
  verify: vi.fn(async () => ({ ok: true, email: 'me@example.com' })),
  withSession: vi.fn(async (fn) => fn(fakeSession)),
  fetchOne: vi.fn(async () => fakeMessage),
}

vi.mock('@/services/email/index.js', () => ({
  getEmailProviderFor: () => fakeProvider,
  verifyConnectionFor: vi.fn(async () => ({ connected: false, message: 'mocked' })),
}))

const { default: app } = await import('@/index.js')

function cookieOf(res: Response): string {
  return res.headers.get('set-cookie')?.split(';')[0] ?? ''
}

const setup = await app.request('/api/auth/setup', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'boss', password: 'admin-password' }),
})
const cookie = cookieOf(setup)

describe('email debug routes use the real EmailProvider interface (withSession/fetchOne)', () => {
  it('GET /api/email/search returns query/count/messageIds and a Gmail-only-debug note instead of 500ing on provider.search', async () => {
    const res = await app.request('/api/email/search?q=test&max=5', { headers: { Cookie: cookie } })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ query: 'test', count: 1, messageIds: ['msg-1'], note: 'Gmail-only debug query' })
  })

  it('GET /api/email/search returns a clear error when the session has no searchRaw (non-Gmail provider)', async () => {
    const sessionWithoutSearchRaw: EmailSession = {
      search: vi.fn(async (): Promise<MessageRef[]> => [{ id: 'msg-1' }]),
      fetch: vi.fn(async () => fakeMessage),
    }
    vi.mocked(fakeProvider.withSession).mockImplementationOnce(async (fn) => fn(sessionWithoutSearchRaw))

    const res = await app.request('/api/email/search?q=test', { headers: { Cookie: cookie } })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/gmail-only/i)
  })

  it('GET /api/email/message/:id returns id/subject/bodyTextPreview instead of 500ing on provider.fetch', async () => {
    const res = await app.request('/api/email/message/msg-1', { headers: { Cookie: cookie } })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({
      id: 'msg-1',
      subject: 'HSBC 信用卡帳單',
      bodyTextPreview: 'body text preview',
    })
  })

  it('GET /api/email/message/:id/parse reaches PDF handling instead of 500ing on provider.fetch', async () => {
    const res = await app.request('/api/email/message/msg-1/parse', { headers: { Cookie: cookie } })
    expect(res.status).toBe(200)
    const body = await res.json()
    // Fake message has no attachments, so it should reach (and stop at) the
    // "no PDF attachments" business-logic response, not crash beforehand.
    expect(body).toMatchObject({ error: 'No PDF attachments found' })
  })
})
