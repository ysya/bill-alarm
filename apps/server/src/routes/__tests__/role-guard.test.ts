import { describe, it, expect } from 'vitest'
import { setupTestDb } from '../../services/__tests__/helpers/test-db.js'

setupTestDb()
process.env.LOG_LEVEL = 'silent'

const { default: app } = await import('@/index.js')

function cookieOf(res: Response): string {
  return res.headers.get('set-cookie')?.split(';')[0] ?? ''
}

const setup = await app.request('/api/auth/setup', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'boss', password: 'admin-password' }),
})
const boss = cookieOf(setup)
await app.request('/api/users', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Cookie: boss },
  body: JSON.stringify({ username: 'kid', password: 'member-password' }),
})
const kidLogin = await app.request('/api/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'kid', password: 'member-password' }),
})
const kid = cookieOf(kidLogin)

describe('admin-only surface', () => {
  const cases: Array<[string, string]> = [
    ['GET', '/api/users'],
    ['POST', '/api/users'],
    ['POST', '/api/config/llm'],
    ['POST', '/api/config/gemini'],
    ['POST', '/api/config/openai'],
    ['POST', '/api/config/telegram'],
    ['POST', '/api/config/scan'],
    ['GET', '/api/config/status'],
    ['POST', '/api/llm/test'],
  ]

  it('member gets 403 on every admin-only route', async () => {
    for (const [method, path] of cases) {
      const res = await app.request(path, {
        method,
        headers: { 'Content-Type': 'application/json', Cookie: kid },
        body: method === 'GET' ? undefined : JSON.stringify({}),
      })
      expect(res.status, `${method} ${path}`).toBe(403)
    }
  })

  it('member is NOT blocked from tenant routes the old allow-list denied', async () => {
    for (const path of ['/api/notification-rules', '/api/bank-accounts', '/api/banks/presets']) {
      const res = await app.request(path, { headers: { Cookie: kid } })
      expect(res.status, path).toBe(200)
    }
  })

  it('admin passes the admin-only surface', async () => {
    const res = await app.request('/api/config/status', { headers: { Cookie: boss } })
    expect(res.status).toBe(200)
  })
})
