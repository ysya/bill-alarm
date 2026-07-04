import { describe, it, expect } from 'vitest'
import { setupTestDb } from './helpers/test-db.js'

setupTestDb()

const { hashPassword, verifyPassword } = await import('../auth.js')

describe('password hashing', () => {
  it('verifies a correct password', () => {
    const stored = hashPassword('correct horse battery staple')
    expect(verifyPassword('correct horse battery staple', stored)).toBe(true)
  })

  it('rejects a wrong password', () => {
    const stored = hashPassword('correct horse battery staple')
    expect(verifyPassword('wrong', stored)).toBe(false)
  })

  it('produces unique salts', () => {
    expect(hashPassword('a')).not.toBe(hashPassword('a'))
  })

  it('rejects malformed stored values', () => {
    expect(verifyPassword('a', 'garbage')).toBe(false)
  })
})

const { createSession, validateSession, destroySession } = await import('../auth.js')
const { default: prisma } = await import('@/prisma.js')

describe('sessions', () => {
  it('creates a session validatable by its token', async () => {
    const { token } = await createSession()
    expect(await validateSession(token)).toBe(true)
  })

  it('stores only the token hash, not the token', async () => {
    const { token } = await createSession()
    const rows = await prisma.session.findMany()
    expect(rows.some(r => r.tokenHash === token)).toBe(false)
  })

  it('rejects unknown and destroyed tokens', async () => {
    expect(await validateSession('deadbeef')).toBe(false)
    const { token } = await createSession()
    await destroySession(token)
    expect(await validateSession(token)).toBe(false)
  })

  it('rejects expired sessions', async () => {
    const { token } = await createSession()
    await prisma.session.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } })
    expect(await validateSession(token)).toBe(false)
  })

  it('extends expiry when last extension is older than 24h', async () => {
    const { token } = await createSession()
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000)
    await prisma.session.updateMany({ data: { lastExtendedAt: old } })
    expect(await validateSession(token)).toBe(true)
    const row = (await prisma.session.findMany())[0]
    expect(row.lastExtendedAt.getTime()).toBeGreaterThan(old.getTime())
  })
})
