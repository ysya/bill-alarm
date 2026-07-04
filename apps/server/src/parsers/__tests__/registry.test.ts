import { describe, it, expect } from 'vitest'
import { getHardcodedParser } from '../registry.js'

describe('getHardcodedParser', () => {
  it('returns the parser for a registered bank code', () => {
    expect(getHardcodedParser('esun')?.bankCode).toBe('esun')
  })

  it('returns null for unknown code or null', () => {
    expect(getHardcodedParser('nonexistent')).toBeNull()
    expect(getHardcodedParser(null)).toBeNull()
  })
})
