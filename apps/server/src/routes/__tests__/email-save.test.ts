import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { setupTestDb } from '../../services/__tests__/helpers/test-db.js'

setupTestDb()
process.env.LOG_LEVEL = 'silent'

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

describe('POST /api/email/save: imapPassword at-rest encryption (write choke point)', () => {
  let originalKey: string | undefined

  beforeEach(() => {
    originalKey = process.env.ENCRYPTION_KEY
  })

  afterEach(() => {
    if (originalKey === undefined) delete process.env.ENCRYPTION_KEY
    else process.env.ENCRYPTION_KEY = originalKey
  })

  it('with ENCRYPTION_KEY set, the stored imapPassword is enc:v1: ciphertext, not the plaintext posted', async () => {
    process.env.ENCRYPTION_KEY = 'email-save-test-key'

    const res = await app.request('/api/email/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ host: 'imap.gmail.com', port: 993, user: 'me@gmail.com', password: 'MyRealMailboxPassword1' }),
    })
    expect(res.status).toBe(200)

    const user = await prisma.user.findUnique({ where: { username: 'boss' } })
    expect(user?.imapPassword?.startsWith('enc:v1:')).toBe(true)
    expect(user?.imapPassword).not.toBe('MyRealMailboxPassword1')

    // Sanity: the real getEmailProviderFor choke point accepts the now-encrypted
    // DB row without error (exact-decrypted-value proof lives in
    // services/__tests__/mailbox.test.ts's dedicated decrypt-choke-point tests).
    const { getEmailProviderFor } = await import('@/services/email/index.js')
    expect(getEmailProviderFor(user!)).not.toBeNull()
  })

  it('without ENCRYPTION_KEY, the stored imapPassword stays plaintext (unchanged app behavior)', async () => {
    delete process.env.ENCRYPTION_KEY

    const res = await app.request('/api/email/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ host: 'imap.gmail.com', port: 993, user: 'me2@gmail.com', password: 'PlainMailboxPw2' }),
    })
    expect(res.status).toBe(200)

    const user = await prisma.user.findUnique({ where: { username: 'boss' } })
    expect(user?.imapPassword).toBe('PlainMailboxPw2')
  })
})
