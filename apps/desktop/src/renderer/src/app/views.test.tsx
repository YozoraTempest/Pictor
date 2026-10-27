// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import type { KernelInfo } from '../../../shared/bridge.js'

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

const { DEFAULT_VIEW, findView, viewsFor } = await import('./views.js')
const { kernelOfView, kernelViewId } = await import('./kernel-scope.js')

/** What `kernels.list()` reports, near enough for the rail to be built. */
function kernel(id: string, label = id, icon: string | null = null): KernelInfo {
  return {
    id,
    label,
    icon,
    default: false,
    available: true,
    capabilities: {
      permission: false,
      approval: false,
      model: false,
      skills: false,
      fork: false,
      commands: false,
      jobs: false,
    },
    modelSource: null,
  }
}

const BUILTINS = [kernel('dsh', 'DeepSeek Harness'), kernel('pi', 'Pi')]

/**
 * Invariants that keep the registry the single source of truth.
 *
 * The list is now built from the kernels this machine mounted, so the invariants are
 * about that function: a duplicate id, an ambiguous position, or a kernel without a
 * page would each be a broken rail rather than a compile error.
 */
describe('view registry', () => {
  it('keeps every id unique', () => {
    const ids = viewsFor(BUILTINS).map((entry) => entry.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('gives each view a unique position inside its group', () => {
    const views = viewsFor(BUILTINS)
    const groups = new Set(views.map((entry) => entry.group))
    for (const group of groups) {
      const orders = views.filter((entry) => entry.group === group).map((entry) => entry.order)
      expect(new Set(orders).size).toBe(orders.length)
    }
  })

  it('starts on a view it declares', () => {
    expect(viewsFor(BUILTINS).some((entry) => entry.id === DEFAULT_VIEW)).toBe(true)
    expect(findView(DEFAULT_VIEW, BUILTINS).id).toBe(DEFAULT_VIEW)
  })

  it('does not bind the same accelerator twice', () => {
    const shortcuts = viewsFor(BUILTINS).flatMap((entry) =>
      entry.shortcut === undefined ? [] : [entry.shortcut],
    )
    expect(new Set(shortcuts).size).toBe(shortcuts.length)
  })

  it('puts home first and one page per mounted kernel after it', () => {
    const primary = viewsFor(BUILTINS)
      .filter((entry) => entry.group === 'primary')
      .sort((a, b) => a.order - b.order)

    expect(primary.map((entry) => entry.id)).toEqual([
      DEFAULT_VIEW,
      ...BUILTINS.map((entry) => kernelViewId(entry.id)),
    ])
    expect(primary.map((entry) => entry.label)).toEqual(['首页', 'DeepSeek Harness', 'Pi'])
  })

  it('puts extensions above settings in the rail', () => {
    // The rail's bottom group is what a person reaches for when the conversation is not
    // in front of them: adding something first, then settings.
    const secondary = viewsFor(BUILTINS)
      .filter((entry) => entry.group === 'secondary')
      .sort((a, b) => a.order - b.order)

    expect(secondary.map((entry) => entry.label)).toEqual(['拓展', '设置'])
  })

  it('draws a page for a kernel this build has never heard of', () => {
    // The point of deriving the rail: installing a kernel adds a destination, and
    // turning one off takes it away — neither is an edit here.
    const installed = viewsFor([kernel('fake', '回声（示例）')])
    const page = installed.find((entry) => entry.id === kernelViewId('fake'))

    expect(page?.label).toBe('回声（示例）')
    expect(kernelOfView(page?.id ?? '')).toBe('fake')
    expect(installed.some((entry) => entry.id === kernelViewId('dsh'))).toBe(false)
  })

  it('takes the rail icon from the kernel that names it', async () => {
    const { Radio } = await import('lucide-react')
    // The rail used to keep a table of icons by kernel id, so an installed kernel could
    // only borrow a generic one. Now the kernel says which icon it wants and the window
    // maps the name — the same vocabulary plugin panels use.
    const named = viewsFor([kernel('echo', '回声', 'radio')]).find(
      (entry) => entry.id === 'kernel:echo',
    )
    expect(named?.icon).toBe(Radio)

    // A name this build does not know still produces a button.
    const unknown = viewsFor([kernel('odd', '奇怪', 'not-a-real-icon')]).find(
      (entry) => entry.id === 'kernel:odd',
    )
    expect(unknown?.icon).toBeDefined()
  })

  it('scopes exactly the kernel pages to their kernel', () => {
    for (const entry of viewsFor(BUILTINS)) {
      const scoped = entry.id.startsWith('kernel:')
      expect(kernelOfView(entry.id) !== null).toBe(scoped)
    }
  })

  it('falls back to home when the page a kernel used to have is gone', () => {
    // A kernel turned off while its page was open leaves a view id nobody declares.
    expect(findView(kernelViewId('dsh'), []).id).toBe(DEFAULT_VIEW)
  })
})
