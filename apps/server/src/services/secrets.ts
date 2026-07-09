import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

// Storage format: enc:v1:<base64 iv>:<base64 ciphertext||authTag>
const PREFIX = 'enc:v1:'
const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12 // bytes — standard/recommended GCM nonce size
const AUTH_TAG_LENGTH = 16 // bytes — GCM's fixed auth tag size

/** 32-byte key derived from ENCRYPTION_KEY, or null when the env var is unset. */
function getKey(): Buffer | null {
  const raw = process.env.ENCRYPTION_KEY
  if (!raw) return null
  return createHash('sha256').update(raw).digest()
}

/** Whether at-rest encryption is currently active (ENCRYPTION_KEY is set). */
export function encryptionEnabled(): boolean {
  return !!process.env.ENCRYPTION_KEY
}

/**
 * Encrypt a plaintext secret for storage. With no ENCRYPTION_KEY configured,
 * returns the value UNCHANGED (no prefix) so the app works identically in
 * plaintext mode — this is what makes encryption "optional".
 *
 * Idempotent: if `plain` already starts with the `enc:v1:` prefix, it is
 * returned UNCHANGED instead of being wrapped again. All call sites today
 * pass genuine user-provided plaintext, never a value already read back from
 * storage, so double-encryption is not a path exercised in practice — but
 * the invariant is now enforced in code (not just assumed) as defense in
 * depth against a future call site that round-trips ciphertext through here.
 */
export function encryptSecret(plain: string): string {
  if (plain.startsWith(PREFIX)) return plain

  const key = getKey()
  if (!key) return plain

  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  const ciphertextAndTag = Buffer.concat([ciphertext, tag])

  return `${PREFIX}${iv.toString('base64')}:${ciphertextAndTag.toString('base64')}`
}

/**
 * Decrypt a stored secret.
 * - No `enc:v1:` prefix → legacy plaintext (or plaintext-mode write); passed
 *   through unchanged. This is what lets pre-existing DB rows keep working
 *   without a data migration.
 * - `enc:v1:` prefix but no ENCRYPTION_KEY configured → misconfiguration
 *   (encrypted data exists but the key to read it is gone); throws rather
 *   than silently returning ciphertext to a caller expecting plaintext.
 * - `enc:v1:` prefix + key → decrypt; a tampered/corrupt value fails GCM's
 *   auth-tag check and throws.
 */
export function decryptSecret(stored: string): string {
  if (!stored.startsWith(PREFIX)) return stored

  const key = getKey()
  if (!key) {
    throw new Error('Cannot decrypt secret: ENCRYPTION_KEY is not set but the stored value is encrypted (enc:v1:)')
  }

  const [ivB64, dataB64] = stored.slice(PREFIX.length).split(':')
  if (!ivB64 || !dataB64) {
    throw new Error('Cannot decrypt secret: malformed enc:v1: value')
  }

  const iv = Buffer.from(ivB64, 'base64')
  const ciphertextAndTag = Buffer.from(dataB64, 'base64')
  const tag = ciphertextAndTag.subarray(ciphertextAndTag.length - AUTH_TAG_LENGTH)
  const ciphertext = ciphertextAndTag.subarray(0, ciphertextAndTag.length - AUTH_TAG_LENGTH)

  const decipher = createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(tag)
  const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()])
  return plain.toString('utf8')
}

/**
 * Decrypted PDF password for a bank, or undefined when none is set. The
 * single choke point for every pdfPassword read site (routes/bills.ts,
 * routes/parser-lab.ts, services/email-parser.ts) so decryptSecret calls
 * aren't scattered across call sites.
 */
export function getBankPdfPassword(bank: { pdfPassword: string | null }): string | undefined {
  return bank.pdfPassword ? decryptSecret(bank.pdfPassword) : undefined
}
