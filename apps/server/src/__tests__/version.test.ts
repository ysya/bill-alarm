import { describe, it, expect, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { getAppVersion, _resetVersionCache } from '@/version.js'

// apps/server/src/__tests__/version.test.ts -> repo root is four levels up.
const rootVersion = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../../package.json', import.meta.url)), 'utf8'),
).version as string

afterEach(() => {
  delete process.env.APP_VERSION
  _resetVersionCache()
})

describe('getAppVersion', () => {
  it('reads the monorepo root package.json version by default', () => {
    _resetVersionCache()
    expect(getAppVersion()).toBe(rootVersion)
    expect(rootVersion).toMatch(/^\d+\.\d+\.\d+/)
  })

  it('prefers APP_VERSION when set', () => {
    process.env.APP_VERSION = '9.9.9-test'
    _resetVersionCache()
    expect(getAppVersion()).toBe('9.9.9-test')
  })

  it('memoizes the first resolution', () => {
    _resetVersionCache()
    const first = getAppVersion()
    process.env.APP_VERSION = 'changed-after-cache'
    expect(getAppVersion()).toBe(first)
  })
})
