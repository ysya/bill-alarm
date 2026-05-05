import prisma from '@/prisma.js'

// Setting keys
export const KEYS = {
  // Email provider abstraction
  EMAIL_PROVIDER: 'email_provider',     // 'gmail-imap' | future providers
  IMAP_HOST: 'imap_host',               // default: imap.gmail.com
  IMAP_PORT: 'imap_port',               // default: 993
  IMAP_USER: 'imap_user',               // email address
  IMAP_PASSWORD: 'imap_password',       // app password

  // Calendar (ICS feed)
  ICS_FEED_TOKEN: 'ics_feed_token',     // random URL token

  // Telegram
  TELEGRAM_BOT_TOKEN: 'telegram_bot_token',
  TELEGRAM_CHAT_ID: 'telegram_chat_id',

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
  [KEYS.EMAIL_PROVIDER]: 'EMAIL_PROVIDER',
  [KEYS.IMAP_HOST]: 'IMAP_HOST',
  [KEYS.IMAP_PORT]: 'IMAP_PORT',
  [KEYS.IMAP_USER]: 'IMAP_USER',
  [KEYS.IMAP_PASSWORD]: 'IMAP_PASSWORD',
  [KEYS.TELEGRAM_BOT_TOKEN]: 'TELEGRAM_BOT_TOKEN',
  [KEYS.TELEGRAM_CHAT_ID]: 'TELEGRAM_CHAT_ID',
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

export async function getSetting(key: string): Promise<string | null> {
  // Env takes priority over DB
  const envKey = ENV_MAP[key]
  const envVal = envKey ? process.env[envKey] : undefined
  if (envVal) return envVal

  // Fallback to DB
  const row = await prisma.setting.findUnique({ where: { key } })
  return row?.value ?? null
}

export async function setSetting(key: string, value: string): Promise<void> {
  await prisma.setting.upsert({
    where: { key },
    update: { value },
    create: { key, value },
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

/** Returns the existing ICS feed token, generating one if absent. */
export async function getOrCreateIcsFeedToken(): Promise<string> {
  let token = await getSetting(KEYS.ICS_FEED_TOKEN)
  if (!token) {
    token = crypto.randomUUID().replace(/-/g, '')
    await setSetting(KEYS.ICS_FEED_TOKEN, token)
  }
  return token
}

/** Force-rotates the ICS feed token. */
export async function rotateIcsFeedToken(): Promise<string> {
  const token = crypto.randomUUID().replace(/-/g, '')
  await setSetting(KEYS.ICS_FEED_TOKEN, token)
  return token
}
