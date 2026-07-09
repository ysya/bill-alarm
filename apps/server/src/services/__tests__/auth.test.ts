import { describe, it, expect, beforeAll } from 'vitest'
import { createHash, randomBytes, scryptSync } from 'node:crypto'
import { setupTestDb } from './helpers/test-db.js'

setupTestDb()

const hashToken = (t: string) => createHash('sha256').update(t).digest('hex')

const { hashPassword, verifyPassword } = await import('../auth.js')

describe('password hashing', () => {
  it('verifies a correct password', async () => {
    const stored = await hashPassword('correct horse battery staple')
    expect(await verifyPassword('correct horse battery staple', stored)).toBe(true)
  })

  it('rejects a wrong password', async () => {
    const stored = await hashPassword('correct horse battery staple')
    expect(await verifyPassword('wrong', stored)).toBe(false)
  })

  it('produces unique salts', async () => {
    expect(await hashPassword('a')).not.toBe(await hashPassword('a'))
  })

  it('rejects malformed stored values', async () => {
    expect(await verifyPassword('a', 'garbage')).toBe(false)
  })

  // Compatibility guard: hashPassword/verifyPassword moved from scryptSync to
  // promisify(scrypt), but the stored `salt:hash` format and scrypt params
  // (N=16384, r=8, p=1, keylen=32) are unchanged. A hash produced by the OLD
  // synchronous path (pre-migration, still on disk for every existing user)
  // must keep verifying correctly under the new async verifyPassword.
  it('a hash produced by the old scryptSync path still verifies under the new async verifyPassword', async () => {
    const salt = randomBytes(16)
    const hash = scryptSync('testpass123', salt, 32, { N: 16384, r: 8, p: 1 })
    const oldStyleStored = `${salt.toString('hex')}:${hash.toString('hex')}`
    expect(await verifyPassword('testpass123', oldStyleStored)).toBe(true)
    expect(await verifyPassword('wrong-password', oldStyleStored)).toBe(false)
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

  it('sessions of a deactivated user are invalid', async () => {
    const u = await prisma.user.create({
      data: { username: 'deact-user', passwordHash: 'x:y', role: 'member' },
    })
    const { token } = await createSession(u.id)
    expect((await validateSession(token)).valid).toBe(true)
    await prisma.user.update({ where: { id: u.id }, data: { deletedAt: new Date() } })
    expect((await validateSession(token)).valid).toBe(false)
  })
})
