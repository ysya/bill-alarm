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
const adminCookie = cookieOf(setup)

describe('notification-rules: channels validation', () => {
  it('POST /api/notification-rules with channels:["calendar"] returns 400', async () => {
    const res = await app.request('/api/notification-rules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        name: 'Calendar Rule',
        daysBefore: 3,
        timeOfDay: '09:00',
        channels: ['calendar'],
      }),
    })
    expect(res.status).toBe(400)
  })

  it('POST /api/notification-rules with channels:["telegram"] returns 201', async () => {
    const res = await app.request('/api/notification-rules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        name: 'Telegram Rule',
        daysBefore: 3,
        timeOfDay: '09:00',
        channels: ['telegram'],
      }),
    })
    expect(res.status).toBe(201)
  })
})

describe('notification-rules: timeOfDay validation', () => {
  it('POST /api/notification-rules with timeOfDay "25:61" (out-of-range clock value) returns 400', async () => {
    const res = await app.request('/api/notification-rules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        name: 'Bad Clock Rule',
        daysBefore: 3,
        timeOfDay: '25:61',
        channels: ['telegram'],
      }),
    })
    expect(res.status).toBe(400)
  })

  it('POST /api/notification-rules with timeOfDay "23:59" (valid boundary) returns 201', async () => {
    const res = await app.request('/api/notification-rules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        name: 'Late Night Rule',
        daysBefore: 3,
        timeOfDay: '23:59',
        channels: ['telegram'],
      }),
    })
    expect(res.status).toBe(201)
  })
})
