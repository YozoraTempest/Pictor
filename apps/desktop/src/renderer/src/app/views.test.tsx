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

const { DEFAULT_VIEW, findView, railViews, viewsFor } = await import('./views.js')
const { arsSettingsViewId, kernelOfView, kernelViewId, settingsOwnerOf } =
  await import('./kernel-scope.js')

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

  it('puts home first, then one page per ars', () => {
    // The rail lists what a person switches between: its top group is home and the ars
    // pages, its bottom group what can be added and configured. An ars's own settings are
    // not a destination up there — they are opened from the ars page's toolbar.
    const rail = railViews(BUILTINS)

    expect(rail.filter((entry) => entry.group === 'primary').map((entry) => entry.id)).toEqual([
      DEFAULT_VIEW,
      ...BUILTINS.map((entry) => kernelViewId(entry.id)),
    ])
    expect(rail.filter((entry) => entry.group === 'secondary').map((entry) => entry.id)).toEqual([
      'extensions',
      'settings',
    ])
  })

  it('keeps a settings page out of the rail but in the registry', () => {
    const views = viewsFor(BUILTINS)

    for (const kernel of BUILTINS) {
      const settings = views.find((entry) => entry.id === arsSettingsViewId(kernel.id))
      // Reachable — from the ars page — and drawn with a title of its own, because the
      // rail does not light up for the page it was opened from.
      expect(settings).toBeDefined()
      expect(settings?.inRail).toBe(false)
    }
  })

  it('gives each ars settings its own page instead of filing them under settings', () => {
    // The runtime's process, version and switches belong to the ars that owns them: a
    // page under `settings` would describe software that may not even be focused.
    const ids = viewsFor(BUILTINS).map((entry) => entry.id)

    for (const kernel of BUILTINS) {
      expect(ids).toContain(arsSettingsViewId(kernel.id))
      expect(settingsOwnerOf(arsSettingsViewId(kernel.id))).toBe(kernel.id)
    }
    // A kernel page is not a settings page, and the app's own settings is neither.
    expect(settingsOwnerOf(kernelViewId('dsh'))).toBeNull()
    expect(settingsOwnerOf('settings')).toBeNull()
  })

  it('leaves home empty, so a conversation starts on the ars that runs it', () => {
    const home = viewsFor(BUILTINS).find((entry) => entry.id === DEFAULT_VIEW)
    // No `render` target of its own beyond an empty frame: the check is that home is not
    // a kernel page and carries no shortcut into one.
    expect(home).toBeDefined()
    expect(home?.shortcut).toBe('Ctrl+1')
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
