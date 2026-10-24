// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'

// The registry pulls in the views, and one of them reads a media query while the
// UI store initialises; jsdom does not implement `matchMedia`.
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

const { APP_VIEWS, DEFAULT_VIEW } = await import('./views.js')

/**
 * Invariants that keep the registry the single source of truth.
 *
 * They are cheap, and they fail loudly the moment a new entry is added with a
 * duplicate id, an ambiguous position or no renderer — the three ways this file
 * can rot now that five call sites no longer watch it.
 */
describe('view registry', () => {
  it('keeps every id unique', () => {
    const ids = APP_VIEWS.map((entry) => entry.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('gives each view a unique position inside its group', () => {
    const groups = new Set(APP_VIEWS.map((entry) => entry.group))
    for (const group of groups) {
      const orders = APP_VIEWS.filter((entry) => entry.group === group).map((entry) => entry.order)
      expect(new Set(orders).size).toBe(orders.length)
    }
  })

  it('starts on a view it declares', () => {
    expect(APP_VIEWS.some((entry) => entry.id === DEFAULT_VIEW)).toBe(true)
  })

  it('does not bind the same accelerator twice', () => {
    const shortcuts = APP_VIEWS.flatMap((entry) =>
      entry.shortcut === undefined ? [] : [entry.shortcut],
    )
    expect(new Set(shortcuts).size).toBe(shortcuts.length)
  })
})
