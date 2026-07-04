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
