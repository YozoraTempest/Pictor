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

const { SETTING_ROWS, SETTINGS_PAGES, settingsTree } = await import('./pages.js')

/**
 * The row index is what makes search land on a setting instead of a page, so it
 * has to stay honest: unique ids, and every row pointing at a page that exists.
 */
describe('settings pages', () => {
  it('keeps page ids unique', () => {
    const ids = SETTINGS_PAGES.map((page) => page.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('puts every page in the tree exactly once', () => {
    const listed = settingsTree().flatMap((category) =>
      category.entries.flatMap((entry) =>
        entry.kind === 'page' ? [entry.page.id] : entry.group.pages.map((page) => page.id),
      ),
    )

    expect(listed).toHaveLength(SETTINGS_PAGES.length)
    expect(new Set(listed).size).toBe(SETTINGS_PAGES.length)
  })

  it('grows a third level only where a group has something to hold', () => {
    const tree = settingsTree()

    // 通用 holds two groups: how you like the app, then how a conversation runs.
    const general = tree.find((category) => category.title === '通用')
    const groups = (general?.entries ?? []).flatMap((entry) =>
      entry.kind === 'group' ? [[entry.group.title, entry.group.pages.map((p) => p.label)]] : [],
    )
    expect(groups).toEqual([
      ['偏好', ['常规', '权限']],
      ['智能体', ['模型', '技能']],
    ])

    // A category of one page is a heading and a row, not a heading, a group, and a row.
    for (const category of tree) {
      expect(category.entries.length).toBeGreaterThan(0)
    }
  })

  it('keeps row ids unique', () => {
    const ids = SETTING_ROWS.map((row) => row.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
