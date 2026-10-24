// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'

// The page registry imports every section, and the UI store reads a media query
// while it initialises; jsdom does not implement `matchMedia`.
vi.stubGlobal('matchMedia', (query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
  addListener: () => undefined,
  removeListener: () => undefined,
  dispatchEvent: () => false,
}))

const { SETTING_ROWS, SETTINGS_PAGES, settingsGroups } = await import('./pages.js')

/**
 * The row index is what makes search land on a setting instead of a page, so it
 * has to stay honest: unique ids, and every row pointing at a page that exists.
 */
describe('settings pages', () => {
  it('keeps page ids unique', () => {
    const ids = SETTINGS_PAGES.map((page) => page.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('groups every page exactly once', () => {
    const grouped = settingsGroups().flatMap((group) => group.pages.map((page) => page.id))
    expect(grouped).toHaveLength(SETTINGS_PAGES.length)
    expect(new Set(grouped).size).toBe(SETTINGS_PAGES.length)
  })

  it('keeps row ids unique', () => {
    const ids = SETTING_ROWS.map((row) => row.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
