import { Globe, Wrench } from 'lucide-react'
import { describe, expect, it, vi } from 'vitest'

import { createBuiltinPanels, iconFor, mergePanels, pluginPanelEntries } from './registry.js'

describe('iconFor', () => {
  it('maps a known icon name', () => {
    expect(iconFor('globe')).toBe(Globe)
  })

  it('falls back for unknown and missing names', () => {
    expect(iconFor('not-a-real-icon')).toBe(Wrench)
    expect(iconFor(undefined)).toBe(Wrench)
  })
})

describe('createBuiltinPanels', () => {
  it('declares built-in panels with the same shape as plugin panels', () => {
    const panels = createBuiltinPanels({ createSession: vi.fn(), openSettings: vi.fn() })

    expect(panels.map((panel) => panel.id)).toEqual(['session.new', 'settings.open'])
    expect(panels.every((panel) => panel.source === 'builtin')).toBe(true)
  })

  it('runs the injected callback', () => {
    const createSession = vi.fn()
    const panels = createBuiltinPanels({ createSession, openSettings: vi.fn() })

    panels[0]?.run()

    expect(createSession).toHaveBeenCalledTimes(1)
  })
})

describe('pluginPanelEntries', () => {
  it('adapts descriptors and invokes by id', () => {
    const invoke = vi.fn()
    const entries = pluginPanelEntries(
      [{ id: 'browser.open', title: '浏览器', icon: 'globe', command: 'browser.open' }],
      invoke,
    )

    expect(entries[0]).toMatchObject({
      id: 'browser.open',
      title: '浏览器',
      description: '',
      source: 'plugin',
    })

    entries[0]?.run()
    expect(invoke).toHaveBeenCalledWith('browser.open', '浏览器')
  })
})

describe('mergePanels', () => {
  it('keeps built-ins first and appends plugin panels', () => {
    const builtin = createBuiltinPanels({ createSession: vi.fn(), openSettings: vi.fn() })
    const plugin = pluginPanelEntries(
      [{ id: 'browser.open', title: '浏览器', command: 'browser.open' }],
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
      [{ id: 'session.new', title: '假的新建会话', command: 'session.new' }],
      vi.fn(),
    )

    const merged = mergePanels(builtin, plugin)

    expect(merged).toHaveLength(2)
    expect(merged.find((panel) => panel.id === 'session.new')?.title).toBe('新建会话')
  })
})
