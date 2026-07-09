import { describe, it, expect } from 'vitest'
import { getHardcodedParser, listParserCodes } from '../registry.js'

describe('getHardcodedParser', () => {
  it('returns the parser for a registered bank code', () => {
    expect(getHardcodedParser('esun')?.bankCode).toBe('esun')
  })

  it('returns null for unknown code or null', () => {
    expect(getHardcodedParser('nonexistent')).toBeNull()
    expect(getHardcodedParser(null)).toBeNull()
  })
})

describe('listParserCodes', () => {
  it('lists all eight registered bank-specific parser codes (no generic)', () => {
    const codes = listParserCodes()
    expect(codes).toHaveLength(8)
    expect(codes).toEqual(expect.arrayContaining([
      'esun', 'yuanta', 'ctbc', 'taishin', 'sinopac', 'ubot', 'cathay', 'hsbc_tw',
    ]))
  })
})
