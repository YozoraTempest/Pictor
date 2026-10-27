import { describe, expect, it } from 'vitest'

import type { ChatMessage } from '@vulonlok/shared'

import {
  lastUsageOf,
  sharePercent,
  usageRows,
  usageSummary,
  type TurnUsage,
} from './context-usage.js'

function usage(overrides: Partial<TurnUsage>): TurnUsage {
  return { input: null, output: null, total: null, ...overrides }
}

describe('usageSummary', () => {
  it('keeps the total the provider reported instead of adding the halves up', () => {
    // A provider that bills cached tokens separately would make input + output
    // disagree with its own total; the total is the number it stands behind.
    const summary = usageSummary(usage({ input: 100, output: 40, total: 120 }), 1000)

    expect(summary?.used).toBe(120)
  })

  it('falls back to the halves when no total came', () => {
    expect(usageSummary(usage({ input: 100, output: 40 }), null)?.used).toBe(140)
  })

  it('says nothing when the report carried no counts at all', () => {
    expect(usageSummary(usage({}), 1000)).toBeNull()
    expect(usageSummary(undefined, 1000)).toBeNull()
  })

  it('divides by the window the model declared', () => {
    const summary = usageSummary(usage({ total: 320 }), 1000)

    expect(summary?.share).toBe(0.32)
    expect(summary?.remaining).toBe(680)
    expect(summary?.level).toBe('ok')
  })

  it('refuses to invent a share when the model declared no window', () => {
    const summary = usageSummary(usage({ total: 320 }), null)

    expect(summary?.used).toBe(320)
    expect(summary?.share).toBeNull()
    expect(summary?.remaining).toBeNull()
    expect(summary?.level).toBe('ok')
  })

  it('treats a zero window as unknown rather than dividing by it', () => {
    expect(usageSummary(usage({ total: 320 }), 0)?.share).toBeNull()
  })

  it('clamps an overrun to a full window', () => {
    const summary = usageSummary(usage({ total: 1500 }), 1000)

    expect(summary?.share).toBe(1)
    expect(summary?.remaining).toBe(0)
    expect(summary?.level).toBe('full')
  })

  it('turns warm at 70% and red at 90%', () => {
    expect(usageSummary(usage({ total: 699 }), 1000)?.level).toBe('ok')
    expect(usageSummary(usage({ total: 700 }), 1000)?.level).toBe('high')
    expect(usageSummary(usage({ total: 899 }), 1000)?.level).toBe('high')
    expect(usageSummary(usage({ total: 900 }), 1000)?.level).toBe('full')
  })
})

describe('usageRows', () => {
  it('lists the counts that came and leaves the missing ones out', () => {
    const counts = usage({ total: 120 })
    const rows = usageRows(counts, usageSummary(counts, null)!)

    expect(rows).toEqual([{ label: '合计', tokens: 120 }])
  })

  it('adds what is left and the window itself once both are known', () => {
    const counts = usage({ input: 100, output: 40, total: 120 })
    const rows = usageRows(counts, usageSummary(counts, 1000)!)

    expect(rows).toEqual([
      { label: '输入', tokens: 100 },
      { label: '输出', tokens: 40 },
      { label: '合计', tokens: 120 },
      { label: '剩余', tokens: 880 },
      { label: '窗口', tokens: 1000 },
    ])
  })
})

describe('sharePercent', () => {
  it('rounds to a whole percent', () => {
    expect(sharePercent(0.724)).toBe('72%')
  })

  it('keeps a sliver of usage visible instead of reading as nothing', () => {
    expect(sharePercent(0.0004)).toBe('<1%')
    expect(sharePercent(0)).toBe('0%')
  })

  it('has nothing to say without a window', () => {
    expect(sharePercent(null)).toBeNull()
  })
})

describe('lastUsageOf', () => {
  const row = (role: ChatMessage['role'], extra: Partial<ChatMessage> = {}): ChatMessage => ({
    id: `${role}-${String(Object.keys(extra).length)}`,
    role,
    text: 'x',
    timestamp: null,
    ...extra,
  })

  it('takes the newest count the transcript carries', () => {
    const messages = [
      row('assistant', { usage: usage({ total: 10 }) }),
      row('user'),
      row('assistant', { usage: usage({ input: 5, output: 2, total: 7 }) }),
    ]

    expect(lastUsageOf(messages)?.total).toBe(7)
  })

  it('says nothing when no row reported one', () => {
    // A conversation from before counts were kept, or one whose kernel never reports
    // them: the meter has to show nothing rather than a made-up zero.
    expect(lastUsageOf([row('user'), row('assistant')])).toBeNull()
    expect(lastUsageOf([])).toBeNull()
  })
})
