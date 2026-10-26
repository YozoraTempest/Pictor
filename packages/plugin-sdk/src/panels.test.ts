import { describe, expect, it } from 'vitest'

import {
  PanelContributionError,
  parsePanelContribution,
  parsePanelContributions,
} from './panels.js'

describe('parsePanelContribution', () => {
  it('accepts a full contribution', () => {
    expect(
      parsePanelContribution({
        id: 'browser.open',
        title: '浏览器',
        description: '在内置浏览器中打开网址',
        icon: 'globe',
        view: 'browser.open',
      }),
    ).toEqual({
      id: 'browser.open',
      title: '浏览器',
      description: '在内置浏览器中打开网址',
      icon: 'globe',
      view: 'browser.open',
    })
  })

  it('drops empty optional fields instead of keeping blanks', () => {
    expect(
      parsePanelContribution({
        id: 'side.chat',
        title: '侧边聊天',
        description: '',
        view: 'side.chat',
      }),
    ).toEqual({ id: 'side.chat', title: '侧边聊天', view: 'side.chat' })
  })

  it('requires an id, a title and a view', () => {
    expect(() => parsePanelContribution({ title: 'x', view: 'x.y' })).toThrow(
      PanelContributionError,
    )
    expect(() => parsePanelContribution({ id: 'x.y', view: 'x.y' })).toThrow(
      /panel.title is required/,
    )
    expect(() => parsePanelContribution({ id: 'x.y', title: 'x' })).toThrow(
      /panel.view is required/,
    )
  })

  it('rejects ids that would be ambiguous in a flat registry', () => {
    expect(() => parsePanelContribution({ id: 'Browser Open', title: 'x', view: 'x.y' })).toThrow(
      /not a valid id/,
    )
    expect(() => parsePanelContribution({ id: 'browser.open', title: 'x', view: 'x y' })).toThrow(
      /not a valid view id/,
    )
  })

  it('rejects icons that are not kebab-case names', () => {
    expect(() =>
      parsePanelContribution({ id: 'x.y', title: 'x', view: 'x.y', icon: 'Globe' }),
    ).toThrow(/kebab-case/)
  })

  it('rejects over-long titles and descriptions', () => {
    expect(() => parsePanelContribution({ id: 'x.y', title: 'a'.repeat(61), view: 'x.y' })).toThrow(
      /longer than 60/,
    )
    expect(() =>
      parsePanelContribution({
        id: 'x.y',
        title: 'x',
        view: 'x.y',
        description: 'a'.repeat(161),
      }),
    ).toThrow(/longer than 160/)
  })

  it('rejects non-object payloads', () => {
    expect(() => parsePanelContribution('browser.open')).toThrow(/must be an object/)
    expect(() => parsePanelContribution(null)).toThrow(/must be an object/)
  })
})

describe('parsePanelContributions', () => {
  it('keeps valid panels and reports the broken ones', () => {
    const result = parsePanelContributions([
      { id: 'a.b', title: 'A', view: 'a.b' },
      { id: 'bad id', title: 'B', view: 'b.c' },
      { id: 'c.d', title: 'C', view: 'c.d' },
    ])

    expect(result.panels.map((panel) => panel.id)).toEqual(['a.b', 'c.d'])
    expect(result.failures).toHaveLength(1)
    expect(result.failures[0]?.id).toBe('bad id')
    expect(result.failures[0]?.reason).toMatch(/not a valid id/)
  })

  it('keeps the first panel for a duplicated id', () => {
    const result = parsePanelContributions([
      { id: 'a.b', title: 'First', view: 'a.b' },
      { id: 'a.b', title: 'Second', view: 'a.b' },
    ])

    expect(result.panels).toHaveLength(1)
    expect(result.panels[0]?.title).toBe('First')
    expect(result.failures[0]?.reason).toMatch(/duplicate panel id/)
  })

  it('reports the id of a failed entry when it has one', () => {
    const result = parsePanelContributions([{ id: 'a.b', title: '', view: 'a.b' }])

    expect(result.panels).toEqual([])
    expect(result.failures[0]?.id).toBe('a.b')
  })
})
