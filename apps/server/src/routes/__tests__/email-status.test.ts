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
const cookie = cookieOf(setup)

describe('GET /api/email/status serves the per-user (rich) handler', () => {
  it('returns the hasCredentials shape, not the slim system.ts shadow', async () => {
    const res = await app.request('/api/email/status', { headers: { Cookie: cookie } })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty('hasCredentials')
    expect(body.hasCredentials).toBe(false) // no imap configured yet
    expect(body).toHaveProperty('host') // richer shape includes host/port/user
  })
})
