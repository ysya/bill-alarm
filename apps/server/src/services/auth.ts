import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import prisma from '@/prisma.js'

// scrypt parameters — interactive-login strength, no native deps
const SCRYPT = { N: 16384, r: 8, p: 1 }
const KEYLEN = 32

// Promisified so password hashing runs off the event loop's synchronous path
// (scryptSync blocks the whole process for its ~100ms cost; scrypt's callback
// form still runs on the libuv threadpool but yields the event loop).
const scryptAsync = promisify(scrypt) as (password: string, salt: Buffer, keylen: number, options: typeof SCRYPT) => Promise<Buffer>

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const hash = await scryptAsync(password, salt, KEYLEN, SCRYPT)
  return `${salt.toString('hex')}:${hash.toString('hex')}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [saltHex, hashHex] = stored.split(':')
  if (!saltHex || !hashHex) return false
  const expected = Buffer.from(hashHex, 'hex')
  if (expected.length !== KEYLEN) return false
  const actual = await scryptAsync(password, Buffer.from(saltHex, 'hex'), KEYLEN, SCRYPT)
  return timingSafeEqual(actual, expected)
}

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 days, rolling
const EXTEND_AFTER_MS = 24 * 60 * 60 * 1000

export interface AuthUser {
  id: string
  username: string
  role: string
}

function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export async function createSession(userId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS)
  await prisma.session.create({ data: { tokenHash: tokenHash(token), expiresAt, userId } })
  // opportunistic cleanup of expired rows
  await prisma.session.deleteMany({ where: { expiresAt: { lt: new Date() } } })
  return { token, expiresAt }
}

export interface SessionValidation {
  valid: boolean
  extended: boolean
  expiresAt: Date | null
  user: AuthUser | null
}

export async function validateSession(token: string): Promise<SessionValidation> {
  const session = await prisma.session.findUnique({
    where: { tokenHash: tokenHash(token) },
    include: { user: true },
  })
  if (!session || session.expiresAt.getTime() < Date.now() || session.user.deletedAt) {
    return { valid: false, extended: false, expiresAt: null, user: null }
  }
  const user: AuthUser = { id: session.user.id, username: session.user.username, role: session.user.role }
  if (Date.now() - session.lastExtendedAt.getTime() > EXTEND_AFTER_MS) {
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS)
    await prisma.session.updateMany({
      where: { id: session.id },
      data: { expiresAt, lastExtendedAt: new Date() },
    })
    return { valid: true, extended: true, expiresAt, user }
  }
  return { valid: true, extended: false, expiresAt: session.expiresAt, user }
}

export async function destroySession(token: string): Promise<void> {
  await prisma.session.deleteMany({ where: { tokenHash: tokenHash(token) } })
}

/** Revoke every session of a user; optionally keep the caller's own session alive. */
export async function destroyUserSessions(userId: string, exceptToken?: string): Promise<void> {
  await prisma.session.deleteMany({
    where: {
      userId,
      ...(exceptToken ? { tokenHash: { not: tokenHash(exceptToken) } } : {}),
    },
  })
}
