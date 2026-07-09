import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { generateContentMock } = vi.hoisted(() => ({
  generateContentMock: vi.fn(),
}))
vi.mock('@google/genai', () => ({
  // Must be a real class (not an arrow fn) — llm-parser.ts calls `new GoogleGenAI(...)`.
  GoogleGenAI: class {
    models = { generateContent: generateContentMock }
  },
}))

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

import { parseBillResponse, testLlmConnection, LlmProvider } from '../llm-parser.js'

describe('parseBillResponse', () => {
  it('uses LLM billingPeriod when valid', () => {
    const bill = parseBillResponse(JSON.stringify({
      amount: 1000, minimumPayment: 100, dueDate: '2026-07-13', billingPeriod: '2026-06',
    }))
    expect(bill?.billingPeriod).toBe('2026-06')
  })

  it('derives previous month without end-of-month overflow', () => {
    // 舊實作 setMonth(-1) 在 3/31 會溢位成 3 月；正確應為 2 月
    const bill = parseBillResponse(JSON.stringify({
      amount: 1000, minimumPayment: null, dueDate: '2026-03-31', billingPeriod: null,
    }))
    expect(bill?.billingPeriod).toBe('2026-02')
  })

  it('crosses year boundary for January due dates', () => {
    const bill = parseBillResponse(JSON.stringify({
      amount: 1000, minimumPayment: null, dueDate: '2026-01-15', billingPeriod: null,
    }))
    expect(bill?.billingPeriod).toBe('2025-12')
  })

  it('returns null for unparseable payloads', () => {
    expect(parseBillResponse('not json')).toBeNull()
    expect(parseBillResponse(JSON.stringify({ amount: null, dueDate: '2026-01-01' }))).toBeNull()
  })
})

// getSetting() checks process.env before the DB, so stubbing env vars is enough to
// drive the provider functions below without a Prisma-backed test DB.
describe('provider 60s timeout', () => {
  const ENV_KEYS = [
    'OPENAI_API_KEY', 'OPENAI_MODEL', 'OPENAI_BASE_URL',
    'OLLAMA_BASE_URL', 'OLLAMA_MODEL',
    'GEMINI_API_KEY', 'GEMINI_MODEL',
  ] as const
  const savedEnv: Partial<Record<typeof ENV_KEYS[number], string | undefined>> = {}

  beforeEach(() => {
    vi.useFakeTimers()
    fetchMock.mockReset()
    generateContentMock.mockReset()
    for (const k of ENV_KEYS) savedEnv[k] = process.env[k]
  })

  afterEach(() => {
    vi.useRealTimers()
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k]
      else process.env[k] = savedEnv[k]
    }
  })

  it('rejects a hung OpenAI request after 60s, not before', async () => {
    process.env.OPENAI_API_KEY = 'test-key'
    process.env.OPENAI_MODEL = 'gpt-4o-mini'
    process.env.OPENAI_BASE_URL = 'https://api.openai.com/v1'
    fetchMock.mockReturnValue(new Promise(() => {})) // never resolves

    const promise = testLlmConnection(LlmProvider.OpenAI)
    // let the getSetting()/fetch() microtask chain reach the fetch call before advancing
    await vi.advanceTimersByTimeAsync(0)

    await vi.advanceTimersByTimeAsync(59_000)
    expect(fetchMock).toHaveBeenCalledTimes(1) // request was actually made, just hanging

    await vi.advanceTimersByTimeAsync(1_000)
    const result = await promise

    expect(result.ok).toBe(false)
    expect(result.message).toBe('OpenAI 請求 超時（60秒）')
  })

  it('rejects a hung Ollama request after 60s', async () => {
    process.env.OLLAMA_BASE_URL = 'http://localhost:11434'
    process.env.OLLAMA_MODEL = 'qwen2.5:1.5b'
    fetchMock.mockReturnValue(new Promise(() => {}))

    const promise = testLlmConnection(LlmProvider.Ollama)
    await vi.advanceTimersByTimeAsync(60_000)
    const result = await promise

    expect(result.ok).toBe(false)
    expect(result.message).toBe('Ollama 請求 超時（60秒）')
  })

  it('rejects a hung Gemini request after 60s', async () => {
    process.env.GEMINI_API_KEY = 'test-key'
    process.env.GEMINI_MODEL = 'gemini-2.5-flash'
    generateContentMock.mockReturnValue(new Promise(() => {}))

    const promise = testLlmConnection(LlmProvider.Gemini)
    await vi.advanceTimersByTimeAsync(60_000)
    const result = await promise

    expect(result.ok).toBe(false)
    expect(result.message).toBe('Gemini 請求 超時（60秒）')
  })

  it('does not time out a provider that responds promptly', async () => {
    process.env.OPENAI_API_KEY = 'test-key'
    process.env.OPENAI_MODEL = 'gpt-4o-mini'
    process.env.OPENAI_BASE_URL = 'https://api.openai.com/v1'
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: 'OK' } }],
    }), { status: 200 }))

    const result = await testLlmConnection(LlmProvider.OpenAI)

    expect(result.ok).toBe(true)
    expect(vi.getTimerCount()).toBe(0) // timeout timer was cleared, nothing left dangling
  })
})
