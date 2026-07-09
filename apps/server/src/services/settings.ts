import prisma from '@/prisma.js'
import { encryptSecret, decryptSecret } from './secrets.js'

// Setting keys
export const KEYS = {
  // Telegram
  TELEGRAM_BOT_TOKEN: 'telegram_bot_token',

  // LLM
  GEMINI_API_KEY: 'gemini_api_key',
  GEMINI_MODEL: 'gemini_model',         // e.g. gemini-2.5-flash
  OPENAI_API_KEY: 'openai_api_key',
  OPENAI_MODEL: 'openai_model',
  OPENAI_BASE_URL: 'openai_base_url',
  LLM_PROVIDER: 'llm_provider',         // 'none' | 'gemini' | 'openai' | 'ollama'
  OLLAMA_BASE_URL: 'ollama_base_url',
  OLLAMA_MODEL: 'ollama_model',

  // Scan
  SCAN_INTERVAL: 'scan_interval',
  SCAN_RANGE_DAYS: 'scan_range_days',
  SCAN_GMAIL_QUERY_EXTRA: 'scan_gmail_query_extra',
  LAST_SCAN_AT: 'last_scan_at',

  // App
  APP_BASE_URL: 'app_base_url',
} as const

const ENV_MAP: Record<string, string> = {
  [KEYS.TELEGRAM_BOT_TOKEN]: 'TELEGRAM_BOT_TOKEN',
  [KEYS.GEMINI_API_KEY]: 'GEMINI_API_KEY',
  [KEYS.GEMINI_MODEL]: 'GEMINI_MODEL',
  [KEYS.OPENAI_API_KEY]: 'OPENAI_API_KEY',
  [KEYS.OPENAI_MODEL]: 'OPENAI_MODEL',
  [KEYS.OPENAI_BASE_URL]: 'OPENAI_BASE_URL',
  [KEYS.LLM_PROVIDER]: 'LLM_PROVIDER',
  [KEYS.OLLAMA_BASE_URL]: 'OLLAMA_BASE_URL',
  [KEYS.OLLAMA_MODEL]: 'OLLAMA_MODEL',
  [KEYS.APP_BASE_URL]: 'APP_BASE_URL',
}

// Keys whose DB-stored value is a genuine secret and should be encrypted at
// rest (see services/secrets.ts). Env-sourced values (ENV_MAP above) are
// NEVER encrypted — getSetting returns them before ever touching the DB or
// decryptSecret, so an operator-supplied env var is always plaintext as-is.
const ENCRYPTED_KEYS = new Set<string>([
  KEYS.TELEGRAM_BOT_TOKEN,
  KEYS.GEMINI_API_KEY,
  KEYS.OPENAI_API_KEY,
])

export async function getSetting(key: string): Promise<string | null> {
  // Env takes priority over DB, and env values are never encrypted.
  const envKey = ENV_MAP[key]
  const envVal = envKey ? process.env[envKey] : undefined
  if (envVal) return envVal

  // Fallback to DB. Legacy plaintext rows (no enc:v1: prefix) pass through
  // decryptSecret unchanged, so pre-existing values keep working as-is.
  const row = await prisma.setting.findUnique({ where: { key } })
  if (!row) return null
  return ENCRYPTED_KEYS.has(key) ? decryptSecret(row.value) : row.value
}

export async function setSetting(key: string, value: string): Promise<void> {
  const stored = ENCRYPTED_KEYS.has(key) ? encryptSecret(value) : value
  await prisma.setting.upsert({
    where: { key },
    update: { value: stored },
    create: { key, value: stored },
  })
}

export async function deleteSetting(key: string): Promise<void> {
  await prisma.setting.deleteMany({ where: { key } })
}

export async function getMultiple(keys: string[]): Promise<Record<string, string | null>> {
  const result: Record<string, string | null> = {}
  for (const key of keys) {
    result[key] = await getSetting(key)
  }
  return result
}
