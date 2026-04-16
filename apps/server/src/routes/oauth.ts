import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { getSetting, setSetting, deleteSetting, KEYS } from '@/services/settings.js'
import { getConnectionStatus } from '@/services/gmail.js'

const app = new Hono()

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/calendar.events',
]

// Start Google OAuth flow — returns the auth URL for the frontend to redirect to
app.get('/google/start', async (c) => {
  const clientId = await getSetting(KEYS.GOOGLE_CLIENT_ID)
  if (!clientId) {
    return c.json({ error: 'Google Client ID not configured' }, 400)
  }

  const origin = getOrigin(c)
  const redirectUri = `${origin}/api/oauth/google/callback`

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
  })

  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params}`
  return c.json({ url: authUrl })
})

// Google OAuth callback — exchanges code for tokens
app.get('/google/callback', async (c) => {
  const code = c.req.query('code')
  const error = c.req.query('error')

  if (error) {
    return c.html(renderResult(false, `授權失敗：${error}`))
  }

  if (!code) {
    return c.html(renderResult(false, '缺少授權碼'))
  }

  const clientId = await getSetting(KEYS.GOOGLE_CLIENT_ID)
  const clientSecret = await getSetting(KEYS.GOOGLE_CLIENT_SECRET)

  if (!clientId || !clientSecret) {
    return c.html(renderResult(false, 'Google OAuth 憑證未設定'))
  }

  const origin = getOrigin(c)
  const redirectUri = `${origin}/api/oauth/google/callback`

  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    })

    const tokens = await tokenRes.json() as Record<string, unknown>

    if (!tokenRes.ok) {
      return c.html(renderResult(false, `Token 交換失敗：${JSON.stringify(tokens)}`))
    }

    if (tokens.refresh_token) {
      await setSetting(KEYS.GOOGLE_REFRESH_TOKEN, tokens.refresh_token as string)
    }

    return c.html(renderResult(true, 'Google 帳號連結成功！你可以關閉此頁面。'))
  } catch (e) {
    return c.html(renderResult(false, `錯誤：${(e as Error).message}`))
  }
})

// Disconnect Google
app.post('/google/disconnect', async (c) => {
  await deleteSetting(KEYS.GOOGLE_REFRESH_TOKEN)
  return c.json({ success: true })
})

// Save Google Client credentials from settings page
app.post('/google/credentials', zValidator('json', z.object({
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
})), async (c) => {
  const { clientId, clientSecret } = c.req.valid('json')
  await setSetting(KEYS.GOOGLE_CLIENT_ID, clientId)
  await setSetting(KEYS.GOOGLE_CLIENT_SECRET, clientSecret)
  return c.json({ success: true })
})

// Save Telegram config from settings page
app.post('/telegram/config', zValidator('json', z.object({
  botToken: z.string().min(1),
  chatId: z.string().min(1),
})), async (c) => {
  const { botToken, chatId } = c.req.valid('json')
  await setSetting(KEYS.TELEGRAM_BOT_TOKEN, botToken)
  await setSetting(KEYS.TELEGRAM_CHAT_ID, chatId)
  return c.json({ success: true })
})

// Save Calendar ID from settings page
app.post('/calendar/config', zValidator('json', z.object({
  calendarId: z.string().min(1),
})), async (c) => {
  const { calendarId } = c.req.valid('json')
  await setSetting(KEYS.GOOGLE_CALENDAR_ID, calendarId)
  return c.json({ success: true })
})

// Toggle calendar auto-create for new bills
app.post('/calendar/toggle', zValidator('json', z.object({
  enabled: z.boolean(),
})), async (c) => {
  const { enabled } = c.req.valid('json')
  await setSetting(KEYS.CALENDAR_ENABLED, enabled ? 'true' : 'false')
  return c.json({ success: true, enabled })
})

// Set scan interval (hours). 0 = disabled, default = 24
app.post('/scan/config', zValidator('json', z.object({
  interval: z.number().int().min(0),
})), async (c) => {
  const { interval } = c.req.valid('json')
  await setSetting(KEYS.SCAN_INTERVAL, String(interval))
  return c.json({ success: true, interval })
})

// Save Gemini API key from settings page
app.post('/gemini/config', zValidator('json', z.object({
  apiKey: z.string().min(1),
})), async (c) => {
  const { apiKey } = c.req.valid('json')
  await setSetting(KEYS.GEMINI_API_KEY, apiKey)
  return c.json({ success: true })
})

// Get current config status (mask sensitive values)
app.get('/status', async (c) => {
  const clientId = await getSetting(KEYS.GOOGLE_CLIENT_ID)
  const clientSecret = await getSetting(KEYS.GOOGLE_CLIENT_SECRET)
  const refreshToken = await getSetting(KEYS.GOOGLE_REFRESH_TOKEN)
  const botToken = await getSetting(KEYS.TELEGRAM_BOT_TOKEN)
  const chatId = await getSetting(KEYS.TELEGRAM_CHAT_ID)
  const calendarId = await getSetting(KEYS.GOOGLE_CALENDAR_ID)
  const geminiKey = await getSetting(KEYS.GEMINI_API_KEY)
  const calendarEnabled = await getSetting(KEYS.CALENDAR_ENABLED)
  const scanInterval = await getSetting(KEYS.SCAN_INTERVAL)

  return c.json({
    google: {
      hasCredentials: !!(clientId && clientSecret),
      isConnected: !!refreshToken,
      email: refreshToken ? (await getGmailEmail()) : null,
    },
    telegram: {
      isConfigured: !!(botToken && chatId),
      chatId: chatId ? mask(chatId) : null,
    },
    calendar: {
      calendarId: calendarId || 'primary',
      enabled: calendarEnabled === 'true',
    },
    scan: {
      interval: scanInterval != null ? parseInt(scanInterval) : 24,
    },
    gemini: {
      isConfigured: !!geminiKey,
    },
  })
})

async function getGmailEmail(): Promise<string | null> {
  const status = await getConnectionStatus()
  if (!status.connected) return null
  // message format: "Connected as xxx@gmail.com"
  return status.message.replace('Connected as ', '')
}

function mask(value: string): string {
  if (value.length <= 8) return '****'
  return value.substring(0, 4) + '****' + value.substring(value.length - 4)
}

function renderResult(success: boolean, message: string): string {
  return `<!DOCTYPE html>
<html lang="zh-TW">
<head><meta charset="UTF-8"><title>${success ? '成功' : '失敗'}</title>
<style>
  body { font-family: system-ui; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; background: #09090b; color: #fafafa; }
  .card { text-align: center; padding: 2rem; border-radius: 0.5rem; border: 1px solid #27272a; max-width: 400px; }
  .icon { font-size: 3rem; margin-bottom: 1rem; }
  .msg { color: #a1a1aa; margin-top: 0.5rem; }
  button { margin-top: 1rem; padding: 0.5rem 1rem; border-radius: 0.375rem; border: 1px solid #27272a; background: #18181b; color: #fafafa; cursor: pointer; }
</style>
</head>
<body>
  <div class="card">
    <div class="icon">${success ? '✅' : '❌'}</div>
    <h2>${success ? '連結成功' : '連結失敗'}</h2>
    <p class="msg">${message}</p>
    <button onclick="window.close()">關閉</button>
  </div>
</body>
</html>`
}

function getOrigin(c: { req: { header: (name: string) => string | undefined; url: string } }): string {
  const proto = c.req.header('x-forwarded-proto') ?? 'http'
  const host = c.req.header('x-forwarded-host') ?? c.req.header('host')
  if (host) return `${proto}://${host}`
  return new URL(c.req.url).origin
}

export default app
