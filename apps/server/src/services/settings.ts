import prisma from '@/prisma.js'

// Setting keys
export const KEYS = {
  GOOGLE_CLIENT_ID: 'google_client_id',
  GOOGLE_CLIENT_SECRET: 'google_client_secret',
  GOOGLE_REFRESH_TOKEN: 'google_refresh_token',
  TELEGRAM_BOT_TOKEN: 'telegram_bot_token',
  TELEGRAM_CHAT_ID: 'telegram_chat_id',
  GOOGLE_CALENDAR_ID: 'google_calendar_id',
  GEMINI_API_KEY: 'gemini_api_key',
  GEMINI_MODEL: 'gemini_model',         // e.g. gemini-2.5-flash
  OPENAI_API_KEY: 'openai_api_key',
  OPENAI_MODEL: 'openai_model',         // e.g. gpt-4o-mini
  OPENAI_BASE_URL: 'openai_base_url',   // e.g. https://api.openai.com/v1 (or OpenRouter, local proxy, etc.)
  CALENDAR_ENABLED: 'calendar_enabled',
  SCAN_INTERVAL: 'scan_interval',
  SCAN_RANGE_DAYS: 'scan_range_days',          // default: 60
  SCAN_GMAIL_QUERY_EXTRA: 'scan_gmail_query_extra', // extra gmail search operators appended to scan query
  LAST_SCAN_AT: 'last_scan_at',
  LLM_PROVIDER: 'llm_provider',         // 'none' | 'gemini' | 'openai' | 'ollama'
  OLLAMA_BASE_URL: 'ollama_base_url',   // e.g. http://ollama:11434
  OLLAMA_MODEL: 'ollama_model',         // e.g. qwen2.5:1.5b
  APP_BASE_URL: 'app_base_url',         // e.g. http://homelab.local:3100 — for Telegram deep links
} as const

const ENV_MAP: Record<string, string> = {
  [KEYS.GOOGLE_CLIENT_ID]: 'GOOGLE_CLIENT_ID',
  [KEYS.GOOGLE_CLIENT_SECRET]: 'GOOGLE_CLIENT_SECRET',
  [KEYS.GOOGLE_REFRESH_TOKEN]: 'GOOGLE_REFRESH_TOKEN',
  [KEYS.TELEGRAM_BOT_TOKEN]: 'TELEGRAM_BOT_TOKEN',
  [KEYS.TELEGRAM_CHAT_ID]: 'TELEGRAM_CHAT_ID',
  [KEYS.GOOGLE_CALENDAR_ID]: 'GOOGLE_CALENDAR_ID',
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
