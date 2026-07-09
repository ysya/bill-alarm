import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { setupTestDb } from './helpers/test-db.js'

setupTestDb()
process.env.LOG_LEVEL = 'silent'

const { default: prisma } = await import('@/prisma.js')
const { getSetting, setSetting, deleteSetting, KEYS } = await import('../settings.js')

// process.env.ENCRYPTION_KEY / process.env.GEMINI_API_KEY etc. are real,
// global, mutable values shared by every test file in this run (vitest
// fileParallelism is false — files run serially in the same process).
// Snapshot and restore around every test so nothing leaks across files.
const ENV_VARS = ['ENCRYPTION_KEY', 'TELEGRAM_BOT_TOKEN', 'GEMINI_API_KEY', 'OPENAI_API_KEY'] as const
let snapshot: Record<string, string | undefined>

beforeEach(() => {
  snapshot = Object.fromEntries(ENV_VARS.map((k) => [k, process.env[k]]))
})

afterEach(() => {
  for (const k of ENV_VARS) {
    if (snapshot[k] === undefined) delete process.env[k]
    else process.env[k] = snapshot[k]
  }
})

describe('settings: at-rest encryption of sensitive keys', () => {
  it('setSetting on gemini_api_key stores enc:v1: ciphertext in the DB; getSetting decrypts it back', async () => {
    process.env.ENCRYPTION_KEY = 'settings-test-key'

    await setSetting(KEYS.GEMINI_API_KEY, 'sk-xxx')

    const row = await prisma.setting.findUnique({ where: { key: KEYS.GEMINI_API_KEY } })
    expect(row?.value.startsWith('enc:v1:')).toBe(true)
    expect(row?.value).not.toBe('sk-xxx')

    expect(await getSetting(KEYS.GEMINI_API_KEY)).toBe('sk-xxx')
  })

  it('setSetting on telegram_bot_token also encrypts (the ENCRYPTED_KEYS set covers more than one key)', async () => {
    process.env.ENCRYPTION_KEY = 'settings-test-key-2'

    await setSetting(KEYS.TELEGRAM_BOT_TOKEN, '123456:ABC-DEF-token')

    const row = await prisma.setting.findUnique({ where: { key: KEYS.TELEGRAM_BOT_TOKEN } })
    expect(row?.value.startsWith('enc:v1:')).toBe(true)
    expect(await getSetting(KEYS.TELEGRAM_BOT_TOKEN)).toBe('123456:ABC-DEF-token')
  })

  it('a non-sensitive key (scan_interval) is never encrypted even with a key configured', async () => {
    process.env.ENCRYPTION_KEY = 'settings-test-key-3'

    await setSetting(KEYS.SCAN_INTERVAL, '24')

    const row = await prisma.setting.findUnique({ where: { key: KEYS.SCAN_INTERVAL } })
    expect(row?.value).toBe('24')
    expect(await getSetting(KEYS.SCAN_INTERVAL)).toBe('24')
  })

  it('legacy plaintext row (written before encryption was enabled) still reads back correctly once a key is set', async () => {
    process.env.ENCRYPTION_KEY = 'settings-test-key-4'

    // A prior test in this file may have already written this key (setSetting
    // upserts) — clear it first so this is a genuine INSERT of a fresh
    // never-encrypted row, matching a real pre-encryption legacy DB row.
    await deleteSetting(KEYS.GEMINI_API_KEY)
    await prisma.setting.create({ data: { key: KEYS.GEMINI_API_KEY, value: 'legacy-plaintext-key' } })

    expect(await getSetting(KEYS.GEMINI_API_KEY)).toBe('legacy-plaintext-key')
  })

  it('without ENCRYPTION_KEY, setSetting stores plaintext and getSetting reads it back unchanged', async () => {
    delete process.env.ENCRYPTION_KEY

    await setSetting(KEYS.OPENAI_API_KEY, 'sk-plain-openai-key')

    const row = await prisma.setting.findUnique({ where: { key: KEYS.OPENAI_API_KEY } })
    expect(row?.value).toBe('sk-plain-openai-key')
    expect(await getSetting(KEYS.OPENAI_API_KEY)).toBe('sk-plain-openai-key')
  })
})

describe('settings: env priority is never decrypted', () => {
  it('an env-sourced value wins over the DB and is returned as-is, without ever calling decryptSecret', async () => {
    process.env.ENCRYPTION_KEY = 'settings-test-key-5'
    process.env.GEMINI_API_KEY = 'env-value-should-win'

    // A malformed enc:v1: value in the DB would throw if getSetting ever
    // tried to decrypt it — proving env priority short-circuits before that.
    await prisma.setting.upsert({
      where: { key: KEYS.GEMINI_API_KEY },
      update: { value: 'enc:v1:not-valid-base64-iv:not-valid-either' },
      create: { key: KEYS.GEMINI_API_KEY, value: 'enc:v1:not-valid-base64-iv:not-valid-either' },
    })

    await expect(getSetting(KEYS.GEMINI_API_KEY)).resolves.toBe('env-value-should-win')
  })
})
