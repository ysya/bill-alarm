/**
 * Google OAuth Refresh Token 取得工具
 *
 * 使用方式：
 * 1. 到 Google Cloud Console → Credentials → Create OAuth 2.0 Client ID
 *    - 類型選「桌面應用程式 (Desktop app)」
 * 2. 取得 Client ID 和 Client Secret
 * 3. 執行：
 *    GOOGLE_CLIENT_ID=xxx GOOGLE_CLIENT_SECRET=yyy npx tsx scripts/get-google-token.ts
 * 4. 開啟瀏覽器，完成授權
 * 5. 複製輸出的 GOOGLE_REFRESH_TOKEN 到 .env
 */

import http from 'node:http'
import { URL } from 'node:url'

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('請設定環境變數：')
  console.error('  GOOGLE_CLIENT_ID=xxx GOOGLE_CLIENT_SECRET=yyy npx tsx scripts/get-google-token.ts')
  process.exit(1)
}

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/calendar.events',
]

const REDIRECT_PORT = 3199
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}`

// Step 1: Generate auth URL
const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth')
authUrl.searchParams.set('client_id', CLIENT_ID)
authUrl.searchParams.set('redirect_uri', REDIRECT_URI)
authUrl.searchParams.set('response_type', 'code')
authUrl.searchParams.set('scope', SCOPES.join(' '))
authUrl.searchParams.set('access_type', 'offline')
authUrl.searchParams.set('prompt', 'consent')

console.log('\n=== Google OAuth Token 取得工具 ===\n')
console.log('請在瀏覽器中開啟以下網址，完成授權：\n')
console.log(authUrl.toString())
console.log('\n等待授權回調...\n')

// Step 2: Start local server to receive callback
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url!, `http://localhost:${REDIRECT_PORT}`)
  const code = url.searchParams.get('code')
  const error = url.searchParams.get('error')

  if (error) {
    res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(`<h1>授權失敗</h1><p>${error}</p>`)
    console.error(`授權失敗：${error}`)
    process.exit(1)
  }

  if (!code) {
    res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end('<h1>缺少授權碼</h1>')
    return
  }

  // Step 3: Exchange code for tokens
  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
        grant_type: 'authorization_code',
      }),
    })

    const tokens = await tokenRes.json() as Record<string, unknown>

    if (!tokenRes.ok) {
      throw new Error(JSON.stringify(tokens))
    }

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end('<h1>授權成功！</h1><p>你可以關閉此頁面，回到終端查看 token。</p>')

    console.log('=== 授權成功 ===\n')
    console.log('請將以下內容加入 apps/server/.env：\n')
    console.log(`GOOGLE_CLIENT_ID=${CLIENT_ID}`)
    console.log(`GOOGLE_CLIENT_SECRET=${CLIENT_SECRET}`)
    console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`)
    console.log('')

    server.close()
    process.exit(0)
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end('<h1>Token 交換失敗</h1>')
    console.error('Token 交換失敗：', e)
    process.exit(1)
  }
})

server.listen(REDIRECT_PORT)
