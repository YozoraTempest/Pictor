import { describe, expect, it } from 'vitest'

import {
  CONVERSATION_CELL,
  SLOT_KEYS,
  SLOT_LIMITS,
  SLOT_SPECS,
  SlotContributionError,
  parseSlotContribution,
  parseSlotContributions,
  slotCellOf,
} from './slots.js'

/**
 * The slot contract.
 *
 * Where a contribution sits is the whole message here, so the cases worth testing are the
 * ones where the address is wrong: a place this window does not have, a key on a slot that
 * holds one entry, no key on a slot that needs one, and two plugins claiming the same cell.
 */
const seat = {
  slot: 'shell.bottom' as const,
  title: '状态条',
  view: 'acme.status',
}

describe('parseSlotContribution', () => {
  it('accepts a single slot without a key', () => {
    expect(parseSlotContribution(seat)).toEqual(seat)
  })

  it('accepts a keyed slot with a key, and keeps the extras', () => {
    expect(
      parseSlotContribution({
        slot: 'main',
        key: 'today',
        title: '今日',
        description: '一页',
        icon: 'blocks',
        view: 'acme.today',
      }),
    ).toEqual({
      slot: 'main',
      key: 'today',
      title: '今日',
      description: '一页',
      icon: 'blocks',
      view: 'acme.today',
    })
  })

  it('refuses a slot this window does not draw', () => {
    // Including `root`: it is the frame itself, and a second entry there would replace the
    // application rather than add to it. Saying so is better than accepting it silently.
    expect(() => parseSlotContribution({ ...seat, slot: 'root' })).toThrow(
      /root is drawn by the window itself/,
    )
    expect(() => parseSlotContribution({ ...seat, slot: 'nowhere' })).toThrow(SlotContributionError)
  })

  it('refuses a key on a slot that holds one entry', () => {
    expect(() => parseSlotContribution({ ...seat, key: 'mine' })).toThrow(/takes no key/)
  })

  it('refuses a keyed slot with no key', () => {
    expect(() => parseSlotContribution({ slot: 'main', title: 'x', view: 'a.b' })).toThrow(
      /needs a key/,
    )
  })

  it('keeps the conversation cell for the transcript', () => {
    // `main` is keyed and the transcript is one of its keys. A plugin taking that cell
    // would be asking to replace the conversation, which is not a thing a plugin does.
    expect(() =>
      parseSlotContribution({
        slot: 'main',
        key: CONVERSATION_CELL,
        title: 'x',
        view: 'a.b',
      }),
    ).toThrow(/reserved for the transcript/)
  })

  it('drops a blank description instead of keeping one', () => {
    expect(parseSlotContribution({ ...seat, description: '' })).toEqual(seat)
  })
})

describe('parseSlotContributions', () => {
  it('keeps the first seat of a cell and reports the second', () => {
    const result = parseSlotContributions([
      { ...seat, title: '第一个' },
      { ...seat, title: '第二个' },
    ])

    expect(result.slots.map((one) => one.title)).toEqual(['第一个'])
    expect(result.failures[0]?.reason).toMatch(/already registered/)
  })

  it('lets different cells of the same slot coexist', () => {
    const result = parseSlotContributions([
      { slot: 'main', key: 'a', title: 'A', view: 'x.a' },
      { slot: 'main', key: 'b', title: 'B', view: 'x.b' },
    ])

    expect(result.slots).toHaveLength(2)
    expect(result.failures).toEqual([])
  })

  it('draws no more overlay entries than the limit, and says why', () => {
    // The layer floats above everything; an unbounded list there eventually covers the
    // app. The cap is reported like any other refusal instead of trimming silently.
    const many = Array.from({ length: SLOT_LIMITS.listEntries + 1 }, (_, index) => ({
      slot: 'shell.overlay' as const,
      key: `entry${String(index)}`,
      title: `第 ${String(index)} 条`,
      view: 'acme.status',
    }))

    const result = parseSlotContributions(many)
    expect(result.slots).toHaveLength(SLOT_LIMITS.listEntries)
    expect(result.failures[0]?.reason).toMatch(/at most/)
  })
})

describe('the slot vocabulary', () => {
  it('covers every place the window actually draws, and no more', () => {
    // One assertion per seat, so adding a slot without a place to put it fails here
    // rather than producing a contribution that quietly does nothing.
    expect(SLOT_KEYS.sort()).toEqual([
      'main',
      'rightbar',
      'shell.bottom',
      'shell.leading',
      'shell.overlay',
      'sidebar',
    ])
    for (const key of SLOT_KEYS) {
      expect(SLOT_SPECS[key].summary.length).toBeGreaterThan(0)
    }
  })

  it('addresses a seat by slot and cell', () => {
    expect(slotCellOf({ slot: 'main', key: 'today', title: 'x', view: 'a.b' })).toBe('today')
    expect(slotCellOf({ slot: 'sidebar', title: 'x', view: 'a.b' })).toBe('sidebar')
  })
})
