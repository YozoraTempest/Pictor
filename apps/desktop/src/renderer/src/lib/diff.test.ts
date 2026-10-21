import { describe, expect, it } from 'vitest'

import { diffLines, formatDiff } from './diff.js'

describe('diffLines', () => {
  it('marks a single changed line as one removal and one addition', () => {
    expect(diffLines('a\nb\nc', 'a\nB\nc')).toEqual([
      { kind: 'context', text: 'a' },
      { kind: 'remove', text: 'b' },
      { kind: 'add', text: 'B' },
      { kind: 'context', text: 'c' },
    ])
  })

  it('keeps shared lines around an insertion', () => {
    expect(diffLines('a\nc', 'a\nb\nc')).toEqual([
      { kind: 'context', text: 'a' },
      { kind: 'add', text: 'b' },
      { kind: 'context', text: 'c' },
    ])
  })

  it('reports a pure deletion', () => {
    expect(diffLines('a\nb', 'a')).toEqual([
      { kind: 'context', text: 'a' },
      { kind: 'remove', text: 'b' },
    ])
  })

  it('handles empty input on either side', () => {
    expect(diffLines('', 'x')).toEqual([{ kind: 'add', text: 'x' }])
    expect(diffLines('x', '')).toEqual([{ kind: 'remove', text: 'x' }])
    expect(diffLines('', '')).toEqual([])
  })

  it('treats identical text as pure context', () => {
    expect(diffLines('same', 'same')).toEqual([{ kind: 'context', text: 'same' }])
  })
})

describe('formatDiff', () => {
  it('prefixes lines the way a unified diff does', () => {
    const text = formatDiff([
      { kind: 'remove', text: 'old' },
      { kind: 'add', text: 'new' },
      { kind: 'context', text: 'keep' },
    ])

    expect(text).toBe('-old\n+new\n keep')
  })
})
