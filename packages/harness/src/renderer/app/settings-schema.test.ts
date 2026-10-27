import { describe, expect, it } from 'vitest'

import {
  GROUPING_DEFAULT,
  readGroupingMode,
  readSectionOrder,
  readSorts,
  SETTING_KEYS,
  sortKey,
} from './settings-schema.js'

describe('settings schema', () => {
  describe('grouping', () => {
    it('falls back to the default when nothing is stored', () => {
      expect(readGroupingMode({})).toBe(GROUPING_DEFAULT)
    })

    it('accepts every declared mode', () => {
      for (const mode of ['overlap', 'pinned', 'basic', 'exclusive'] as const) {
        expect(readGroupingMode({ [SETTING_KEYS.grouping]: mode })).toBe(mode)
      }
    })

    it('ignores values it does not know', () => {
      expect(readGroupingMode({ [SETTING_KEYS.grouping]: 'exclusive-ish' })).toBe(GROUPING_DEFAULT)
      expect(readGroupingMode({ [SETTING_KEYS.grouping]: 3 })).toBe(GROUPING_DEFAULT)
    })

    it('maps the superseded boolean flag onto pinned', () => {
      // The old flag only knew "pinned on/off", so `true` means the pinned mode.
      expect(readGroupingMode({ [SETTING_KEYS.legacyGroupingExclusive]: true })).toBe('pinned')
      expect(readGroupingMode({ [SETTING_KEYS.legacyGroupingExclusive]: false })).toBe(
        GROUPING_DEFAULT,
      )
    })

    it('prefers the current key over the legacy one', () => {
      expect(
        readGroupingMode({
          [SETTING_KEYS.grouping]: 'basic',
          [SETTING_KEYS.legacyGroupingExclusive]: true,
        }),
      ).toBe('basic')
    })
  })

  describe('section order', () => {
    it('returns an empty list when nothing is stored', () => {
      expect(readSectionOrder({})).toEqual([])
    })

    it('drops entries that are not usable keys', () => {
      expect(
        readSectionOrder({ [SETTING_KEYS.sectionOrder]: ['pinned', '', 7, null, 'recent'] }),
      ).toEqual(['pinned', 'recent'])
    })

    it('ignores a value that is not a list', () => {
      expect(readSectionOrder({ [SETTING_KEYS.sectionOrder]: 'pinned' })).toEqual([])
    })
  })

  describe('sorts', () => {
    it('collects only the sort keys it understands', () => {
      const sorts = readSorts({
        [sortKey('recent')]: 'manual',
        [sortKey('pinned')]: 'created',
        [sortKey('projects')]: 'nonsense',
        'sessions.grouping': 'basic',
      })

      // `manual` must survive a reload, otherwise a drag would undo itself.
      expect(sorts).toEqual({ recent: 'manual', pinned: 'created' })
    })

    it('builds the key it reads back', () => {
      expect(sortKey('section-1')).toBe(`${SETTING_KEYS.sortPrefix}section-1`)
      expect(readSorts({ [sortKey('section-1')]: 'updated' })).toEqual({ 'section-1': 'updated' })
    })
  })
})
