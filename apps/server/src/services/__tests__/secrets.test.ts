import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { encryptSecret, decryptSecret, encryptionEnabled, getBankPdfPassword } from '../secrets.js'

// process.env.ENCRYPTION_KEY is a real, global, mutable value shared by every
// test file in this run (vitest fileParallelism is false, so files run
// serially in the same process). Capture whatever was there before each test
// and restore it after, so nothing here can leak into other test files.
let originalKey: string | undefined

beforeEach(() => {
  originalKey = process.env.ENCRYPTION_KEY
})

afterEach(() => {
  if (originalKey === undefined) delete process.env.ENCRYPTION_KEY
  else process.env.ENCRYPTION_KEY = originalKey
})

describe('secrets: without ENCRYPTION_KEY (plaintext mode)', () => {
  beforeEach(() => {
    delete process.env.ENCRYPTION_KEY
  })

  it('encryptionEnabled() is false', () => {
    expect(encryptionEnabled()).toBe(false)
  })

  it('encryptSecret returns the plaintext unchanged (no prefix added)', () => {
    expect(encryptSecret('my-secret-value')).toBe('my-secret-value')
  })

  it('decryptSecret passes through a value with no enc:v1: prefix unchanged (legacy plaintext)', () => {
    expect(decryptSecret('some-legacy-plaintext-token')).toBe('some-legacy-plaintext-token')
  })

  it('decryptSecret throws when given an enc:v1: value but no key is configured (misconfiguration)', () => {
    process.env.ENCRYPTION_KEY = 'temp-key-used-only-to-produce-a-real-enc-value'
    const encrypted = encryptSecret('secret-under-a-key')
    delete process.env.ENCRYPTION_KEY

    expect(encrypted.startsWith('enc:v1:')).toBe(true)
    expect(() => decryptSecret(encrypted)).toThrow()
  })
})

describe('secrets: with ENCRYPTION_KEY set (encrypted mode)', () => {
  beforeEach(() => {
    process.env.ENCRYPTION_KEY = 'test-encryption-key-do-not-use-in-prod'
  })

  it('encryptionEnabled() is true', () => {
    expect(encryptionEnabled()).toBe(true)
  })

  it('encryptSecret produces the enc:v1:<iv>:<ct+tag> format', () => {
    const encrypted = encryptSecret('my-api-key')
    expect(encrypted.startsWith('enc:v1:')).toBe(true)
    const parts = encrypted.split(':')
    expect(parts).toHaveLength(4)
    expect(parts[0]).toBe('enc')
    expect(parts[1]).toBe('v1')
    expect(parts[2].length).toBeGreaterThan(0) // base64 iv
    expect(parts[3].length).toBeGreaterThan(0) // base64 ciphertext+tag
  })

  it('roundtrips: decryptSecret(encryptSecret(x)) === x', () => {
    const plain = 'sk-super-secret-api-key-1234567890'
    expect(decryptSecret(encryptSecret(plain))).toBe(plain)
  })

  it('roundtrips values containing unicode / multibyte characters', () => {
    const plain = '密碼🔑with-emoji-and-中文字元'
    expect(decryptSecret(encryptSecret(plain))).toBe(plain)
  })

  it('produces a different ciphertext each time (random IV per call), both still decrypt correctly', () => {
    const a = encryptSecret('same-plaintext')
    const b = encryptSecret('same-plaintext')
    expect(a).not.toBe(b)
    expect(decryptSecret(a)).toBe('same-plaintext')
    expect(decryptSecret(b)).toBe('same-plaintext')
  })

  it('tampered ciphertext fails GCM authentication and throws', () => {
    const encrypted = encryptSecret('tamper-test-value')
    const parts = encrypted.split(':')
    const ctTag = parts[3]
    const flipped = (ctTag[0] === 'A' ? 'B' : 'A') + ctTag.slice(1)
    const tampered = [parts[0], parts[1], parts[2], flipped].join(':')

    expect(() => decryptSecret(tampered)).toThrow()
  })

  it('decryptSecret still passes through legacy plaintext even when a key is configured', () => {
    // A row written before ENCRYPTION_KEY was ever set has no prefix — must
    // keep working after encryption is turned on, not just before.
    expect(decryptSecret('legacy-plaintext-written-before-encryption-was-enabled')).toBe(
      'legacy-plaintext-written-before-encryption-was-enabled',
    )
  })
})

describe('secrets: getBankPdfPassword (pdfPassword read choke point)', () => {
  afterEach(() => {
    delete process.env.ENCRYPTION_KEY
  })

  it('returns undefined when the bank has no pdfPassword', () => {
    expect(getBankPdfPassword({ pdfPassword: null })).toBeUndefined()
  })

  it('returns the value unchanged when it is legacy plaintext (no key configured)', () => {
    expect(getBankPdfPassword({ pdfPassword: 'PlainBankPass1' })).toBe('PlainBankPass1')
  })

  it('decrypts an enc:v1: pdfPassword when a key is configured', () => {
    process.env.ENCRYPTION_KEY = 'bank-pw-test-key'
    const stored = encryptSecret('MyBankPdfPass9')
    expect(stored.startsWith('enc:v1:')).toBe(true)
    expect(getBankPdfPassword({ pdfPassword: stored })).toBe('MyBankPdfPass9')
  })
})
