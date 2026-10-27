import { describe, expect, it } from 'vitest'

import { formatTokens } from './format-time.js'

describe('formatTokens', () => {
  it('keeps small counts exact', () => {
    expect(formatTokens(0)).toBe('0')
    expect(formatTokens(812)).toBe('812')
    expect(formatTokens(999)).toBe('999')
  })

  it('rounds to one decimal where the digit still means something', () => {
    expect(formatTokens(1000)).toBe('1.0k')
    expect(formatTokens(12_400)).toBe('12.4k')
    expect(formatTokens(99_900)).toBe('99.9k')
  })

  it('drops the noise above a hundred thousand', () => {
    expect(formatTokens(100_000)).toBe('100k')
    expect(formatTokens(999_000)).toBe('999k')
    expect(formatTokens(1_000_000)).toBe('1.0M')
    expect(formatTokens(2_500_000)).toBe('2.5M')
  })

  it('refuses nonsense', () => {
    expect(formatTokens(-5)).toBe('0')
    expect(formatTokens(Number.NaN)).toBe('0')
  })
})
