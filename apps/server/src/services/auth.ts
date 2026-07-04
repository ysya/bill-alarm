import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

// scrypt parameters — interactive-login strength, no native deps
const SCRYPT = { N: 16384, r: 8, p: 1 }
const KEYLEN = 32

export function hashPassword(password: string): string {
  const salt = randomBytes(16)
  const hash = scryptSync(password, salt, KEYLEN, SCRYPT)
  return `${salt.toString('hex')}:${hash.toString('hex')}`
}

export function verifyPassword(password: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(':')
  if (!saltHex || !hashHex) return false
  const expected = Buffer.from(hashHex, 'hex')
  if (expected.length !== KEYLEN) return false
  const actual = scryptSync(password, Buffer.from(saltHex, 'hex'), KEYLEN, SCRYPT)
  return timingSafeEqual(actual, expected)
}
