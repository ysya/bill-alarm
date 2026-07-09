import { describe, it, expect } from 'vitest'
import { getHardcodedParser, listParserCodes } from '../registry.js'
import { FIXTURES } from './fixtures.js'

describe('hardcoded bank parsers', () => {
  for (const code of listParserCodes()) {
    it(`${code} parses its fixture`, () => {
      const fixture = FIXTURES[code]
      expect(fixture, `missing fixture for ${code} — add one to fixtures.ts`).toBeDefined()
      const bill = getHardcodedParser(code)!.parse(fixture.text)
      expect(bill).not.toBeNull()
      expect(bill).toMatchObject(fixture.expected)
    })
  }
})
