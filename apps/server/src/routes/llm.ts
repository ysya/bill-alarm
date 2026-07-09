import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { suggestRuleWithLLM, testLlmConnection, getLlmProvider, LlmProvider } from '@/services/llm-parser.js'
import { adminOnly } from '@/middleware/admin-only.js'

const app = new Hono()

// Current LLM provider status
app.get('/llm/status', async (c) => {
  const provider = await getLlmProvider()
  return c.json({ provider })
})

// Test LLM connection (provider + config must already be saved)
app.post('/llm/test', adminOnly, async (c) => {
  const provider = await getLlmProvider()
  if (provider === LlmProvider.None) return c.json({ ok: false, message: 'LLM 提供者未設定' })
  const result = await testLlmConnection(provider)
  return c.json(result)
})

// Ask LLM to suggest a rule from a selection
app.post('/llm/suggest-rule', zValidator('json', z.object({
  text: z.string().min(1),
  value: z.string().min(1),
  startIndex: z.number().int().min(0),
  fieldLabel: z.string().min(1),
})), async (c) => {
  const { text, value, startIndex, fieldLabel } = c.req.valid('json')
  try {
    const rule = await suggestRuleWithLLM(text, value, startIndex, fieldLabel)
    if (!rule) return c.json({ error: 'LLM 回傳格式無法解析' }, 422)
    return c.json({ rule })
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500)
  }
})

export default app
