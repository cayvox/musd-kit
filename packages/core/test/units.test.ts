import { describe, expect, it } from 'vitest'
import { formatBtc, formatMusd, parseBps, parseBtc, parseMusd } from '../src'

describe('units, 18-decimal helpers (docs/08 §5)', () => {
  it('parseBtc / parseMusd parse to 1e18-scaled wei', () => {
    expect(parseBtc('0.05')).toBe(5n * 10n ** 16n)
    expect(parseMusd('2500')).toBe(2500n * 10n ** 18n)
    expect(parseBtc('1')).toBe(10n ** 18n)
  })

  it('formatBtc / formatMusd round-trip', () => {
    expect(formatBtc(parseBtc('0.05'))).toBe('0.05')
    expect(formatMusd(parseMusd('1234.5'))).toBe('1234.5')
  })

  it('parseBps gives the 1e18-scaled fraction the fee guards expect (100 bps = 1% = 1e16)', () => {
    expect(parseBps(100)).toBe(10n ** 16n) // 1%
    expect(parseBps(50)).toBe(5n * 10n ** 15n) // 0.5%
    expect(parseBps(10_000)).toBe(10n ** 18n) // 100%
  })
})
