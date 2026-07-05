import { describe, it, expect, beforeAll } from 'vitest'
import { createHash } from 'node:crypto'
import { setupTestDb } from './helpers/test-db.js'

setupTestDb()

const hashToken = (t: string) => createHash('sha256').update(t).digest('hex')

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

const { createSession, validateSession, destroySession, destroyUserSessions } = await import('../auth.js')
const { default: prisma } = await import('@/prisma.js')

describe('sessions', () => {
  let userId: string

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { username: 'session-user', passwordHash: 'x:y', role: 'admin' },
    })
    userId = user.id
  })

  it('creates a session validatable by its token, carrying the user', async () => {
    const { token } = await createSession(userId)
    const result = await validateSession(token)
    expect(result.valid).toBe(true)
    expect(result.user).toEqual({ id: userId, username: 'session-user', role: 'admin' })
  })

  it('stores only the token hash, not the token', async () => {
    const { token } = await createSession(userId)
    const rows = await prisma.session.findMany()
    expect(rows.some(r => r.tokenHash === token)).toBe(false)
  })

  it('rejects unknown and destroyed tokens', async () => {
    expect((await validateSession('deadbeef')).valid).toBe(false)
    const { token } = await createSession(userId)
    await destroySession(token)
    expect((await validateSession(token)).valid).toBe(false)
  })

  it('rejects expired sessions', async () => {
    const { token } = await createSession(userId)
    await prisma.session.updateMany({ where: { tokenHash: hashToken(token) }, data: { expiresAt: new Date(Date.now() - 1000) } })
    expect((await validateSession(token)).valid).toBe(false)
  })

  it('extends expiry when last extension is older than 24h', async () => {
    const { token } = await createSession(userId)
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000)
    await prisma.session.updateMany({ where: { tokenHash: hashToken(token) }, data: { lastExtendedAt: old } })
    const result = await validateSession(token)
    expect(result.valid).toBe(true)
    expect(result.extended).toBe(true)
    const row = await prisma.session.findUnique({ where: { tokenHash: hashToken(token) } })
    expect(row).not.toBeNull()
    expect(row!.lastExtendedAt.getTime()).toBeGreaterThan(old.getTime())
  })

  it('destroyUserSessions revokes all sessions except the given token', async () => {
    const a = await createSession(userId)
    const b = await createSession(userId)
    await destroyUserSessions(userId, a.token)
    expect((await validateSession(a.token)).valid).toBe(true)
    expect((await validateSession(b.token)).valid).toBe(false)
    await destroyUserSessions(userId)
    expect((await validateSession(a.token)).valid).toBe(false)
  })
})
