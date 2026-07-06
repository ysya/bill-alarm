import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { getSetting, setSetting, KEYS } from '@/services/settings.js'
import { LlmProvider } from '@/services/llm-parser.js'
import prisma from '@/prisma.js'

const app = new Hono()

// Save Telegram config (bot token only; chat ids live on users now)
app.post('/telegram', zValidator('json', z.object({
  botToken: z.string().min(1),
})), async (c) => {
  await setSetting(KEYS.TELEGRAM_BOT_TOKEN, c.req.valid('json').botToken)
  return c.json({ success: true })
})

// Set scan config (interval + range + extra query)
app.post('/scan', zValidator('json', z.object({
  interval: z.number().int().min(0).optional(),
  rangeDays: z.number().int().min(1).max(365).optional(),
  queryExtra: z.string().max(500).optional(),
})), async (c) => {
  const { interval, rangeDays, queryExtra } = c.req.valid('json')
  if (interval != null) await setSetting(KEYS.SCAN_INTERVAL, String(interval))
  if (rangeDays != null) await setSetting(KEYS.SCAN_RANGE_DAYS, String(rangeDays))
  if (queryExtra != null) await setSetting(KEYS.SCAN_GMAIL_QUERY_EXTRA, queryExtra)
  return c.json({ success: true })
})

// LLM API key shortcuts
app.post('/gemini', zValidator('json', z.object({ apiKey: z.string().min(1) })), async (c) => {
  await setSetting(KEYS.GEMINI_API_KEY, c.req.valid('json').apiKey)
  return c.json({ success: true })
})

app.post('/openai', zValidator('json', z.object({ apiKey: z.string().min(1) })), async (c) => {
  await setSetting(KEYS.OPENAI_API_KEY, c.req.valid('json').apiKey)
  return c.json({ success: true })
})

app.post('/llm', zValidator('json', z.object({
  provider: z.nativeEnum(LlmProvider),
  geminiModel: z.string().min(1).optional(),
  openaiModel: z.string().min(1).optional(),
  openaiBaseUrl: z.string().url().optional(),
  ollamaBaseUrl: z.string().url().optional(),
  ollamaModel: z.string().min(1).optional(),
})), async (c) => {
  const { provider, geminiModel, openaiModel, openaiBaseUrl, ollamaBaseUrl, ollamaModel } = c.req.valid('json')
  await setSetting(KEYS.LLM_PROVIDER, provider)
  if (geminiModel) await setSetting(KEYS.GEMINI_MODEL, geminiModel)
  if (openaiModel) await setSetting(KEYS.OPENAI_MODEL, openaiModel)
  if (openaiBaseUrl) await setSetting(KEYS.OPENAI_BASE_URL, openaiBaseUrl)
  if (ollamaBaseUrl) await setSetting(KEYS.OLLAMA_BASE_URL, ollamaBaseUrl)
  if (ollamaModel) await setSetting(KEYS.OLLAMA_MODEL, ollamaModel)
  return c.json({ success: true })
})

// Aggregated config status
app.get('/status', async (c) => {
  const [
    botToken,
    geminiKey, openaiKey,
    scanInterval, scanRangeDays, scanQueryExtra,
    llmProvider, geminiModel, openaiModel, openaiBaseUrl, ollamaBaseUrl, ollamaModel,
  ] = await Promise.all([
    getSetting(KEYS.TELEGRAM_BOT_TOKEN),
    getSetting(KEYS.GEMINI_API_KEY), getSetting(KEYS.OPENAI_API_KEY),
    getSetting(KEYS.SCAN_INTERVAL), getSetting(KEYS.SCAN_RANGE_DAYS), getSetting(KEYS.SCAN_GMAIL_QUERY_EXTRA),
    getSetting(KEYS.LLM_PROVIDER), getSetting(KEYS.GEMINI_MODEL), getSetting(KEYS.OPENAI_MODEL),
    getSetting(KEYS.OPENAI_BASE_URL), getSetting(KEYS.OLLAMA_BASE_URL), getSetting(KEYS.OLLAMA_MODEL),
  ])

  return c.json({
    telegram: {
      isConfigured: !!botToken,
      boundCount: await prisma.user.count({ where: { telegramChatId: { not: null } } }),
    },
    scan: {
      interval: scanInterval != null ? parseInt(scanInterval) : 24,
      rangeDays: scanRangeDays != null ? parseInt(scanRangeDays) : 60,
      queryExtra: scanQueryExtra ?? '',
    },
    gemini: { isConfigured: !!geminiKey },
    openai: { isConfigured: !!openaiKey },
    llm: {
      provider: (llmProvider as LlmProvider) ?? LlmProvider.None,
      geminiModel: geminiModel || 'gemini-2.5-flash',
      openaiModel: openaiModel || 'gpt-4o-mini',
      openaiBaseUrl: openaiBaseUrl || 'https://api.openai.com/v1',
      ollamaBaseUrl: ollamaBaseUrl || 'http://localhost:11434',
      ollamaModel: ollamaModel || 'qwen2.5:1.5b',
    },
  })
})

export default app
