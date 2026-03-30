import prisma from '../db/prisma.js'

// Setting keys
export const KEYS = {
  GOOGLE_CLIENT_ID: 'google_client_id',
  GOOGLE_CLIENT_SECRET: 'google_client_secret',
  GOOGLE_REFRESH_TOKEN: 'google_refresh_token',
  TELEGRAM_BOT_TOKEN: 'telegram_bot_token',
  TELEGRAM_CHAT_ID: 'telegram_chat_id',
  GOOGLE_CALENDAR_ID: 'google_calendar_id',
  GEMINI_API_KEY: 'gemini_api_key',
} as const

const ENV_MAP: Record<string, string> = {
  [KEYS.GOOGLE_CLIENT_ID]: 'GOOGLE_CLIENT_ID',
  [KEYS.GOOGLE_CLIENT_SECRET]: 'GOOGLE_CLIENT_SECRET',
  [KEYS.GOOGLE_REFRESH_TOKEN]: 'GOOGLE_REFRESH_TOKEN',
  [KEYS.TELEGRAM_BOT_TOKEN]: 'TELEGRAM_BOT_TOKEN',
  [KEYS.TELEGRAM_CHAT_ID]: 'TELEGRAM_CHAT_ID',
  [KEYS.GOOGLE_CALENDAR_ID]: 'GOOGLE_CALENDAR_ID',
  [KEYS.GEMINI_API_KEY]: 'GEMINI_API_KEY',
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
