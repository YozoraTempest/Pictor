import { Globe, Wrench } from 'lucide-react'
import { describe, expect, it, vi } from 'vitest'

import { createBuiltinPanels, iconFor, mergePanels, pluginPanelEntries } from './registry.js'

describe('iconFor', () => {
  it('maps a known name and falls back for the rest', () => {
    expect(iconFor('globe')).toBe(Globe)
    // A plugin may name an icon this build does not have, or none at all.
    expect(iconFor('not-a-real-icon')).toBe(Wrench)
    expect(iconFor(undefined)).toBe(Wrench)
  })
})

describe('createBuiltinPanels', () => {
  it('runs the injected callback', () => {
    const createSession = vi.fn()
    const panels = createBuiltinPanels({ createSession, openSettings: vi.fn() })

    panels[0]?.run()

    expect(createSession).toHaveBeenCalledTimes(1)
  })
})

describe('pluginPanelEntries', () => {
  it('adapts a descriptor and opens it as the view it names', () => {
    const open = vi.fn()
    const panel = { id: 'browser.open', title: '浏览器', icon: 'globe', view: 'browser.state' }
    const entries = pluginPanelEntries([panel], open)

    expect(entries[0]).toMatchObject({
      id: 'browser.open',
      title: '浏览器',
      description: '',
      source: 'plugin',
      // The view travels with the entry: that is what the column renders.
      view: 'browser.state',
    })

    entries[0]?.run()
    expect(open).toHaveBeenCalledWith(panel)
  })
})

describe('mergePanels', () => {
  it('keeps built-ins first and appends plugin panels', () => {
    const builtin = createBuiltinPanels({ createSession: vi.fn(), openSettings: vi.fn() })
    const plugin = pluginPanelEntries(
      [{ id: 'browser.open', title: '浏览器', view: 'browser.state' }],
      vi.fn(),
    )

    expect(mergePanels(builtin, plugin).map((panel) => panel.id)).toEqual([
      'session.new',
      'settings.open',
      'browser.open',
    ])
  })

  it('lets a built-in win an id collision', () => {
    const builtin = createBuiltinPanels({ createSession: vi.fn(), openSettings: vi.fn() })
    const plugin = pluginPanelEntries(
      [{ id: 'session.new', title: '假的新建会话', view: 'fake.view' }],
      vi.fn(),
    )

    const merged = mergePanels(builtin, plugin)

    expect(merged).toHaveLength(2)
    expect(merged.find((panel) => panel.id === 'session.new')?.title).toBe('新建会话')
  })
})
