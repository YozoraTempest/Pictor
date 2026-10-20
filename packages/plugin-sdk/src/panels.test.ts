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
        command: 'browser.open',
      }),
    ).toEqual({
      id: 'browser.open',
      title: '浏览器',
      description: '在内置浏览器中打开网址',
      icon: 'globe',
      command: 'browser.open',
    })
  })

  it('drops empty optional fields instead of keeping blanks', () => {
    expect(
      parsePanelContribution({
        id: 'side.chat',
        title: '侧边聊天',
        description: '',
        command: 'side.chat',
      }),
    ).toEqual({ id: 'side.chat', title: '侧边聊天', command: 'side.chat' })
  })

  it('requires an id, a title and a command', () => {
    expect(() => parsePanelContribution({ title: 'x', command: 'x.y' })).toThrow(
      PanelContributionError,
    )
    expect(() => parsePanelContribution({ id: 'x.y', command: 'x.y' })).toThrow(
      /panel.title is required/,
    )
    expect(() => parsePanelContribution({ id: 'x.y', title: 'x' })).toThrow(
      /panel.command is required/,
    )
  })

  it('rejects ids that would be ambiguous in a flat registry', () => {
    expect(() =>
      parsePanelContribution({ id: 'Browser Open', title: 'x', command: 'x.y' }),
    ).toThrow(/not a valid id/)
    expect(() =>
      parsePanelContribution({ id: 'browser.open', title: 'x', command: 'x y' }),
    ).toThrow(/not a valid command id/)
  })

  it('rejects icons that are not kebab-case names', () => {
    expect(() =>
      parsePanelContribution({ id: 'x.y', title: 'x', command: 'x.y', icon: 'Globe' }),
    ).toThrow(/kebab-case/)
  })

  it('rejects over-long titles and descriptions', () => {
    expect(() =>
      parsePanelContribution({ id: 'x.y', title: 'a'.repeat(61), command: 'x.y' }),
    ).toThrow(/longer than 60/)
    expect(() =>
      parsePanelContribution({
        id: 'x.y',
        title: 'x',
        command: 'x.y',
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
      { id: 'a.b', title: 'A', command: 'a.b' },
      { id: 'bad id', title: 'B', command: 'b.c' },
      { id: 'c.d', title: 'C', command: 'c.d' },
    ])

    expect(result.panels.map((panel) => panel.id)).toEqual(['a.b', 'c.d'])
    expect(result.failures).toHaveLength(1)
    expect(result.failures[0]?.id).toBe('bad id')
    expect(result.failures[0]?.reason).toMatch(/not a valid id/)
  })

  it('keeps the first tool for a duplicated id', () => {
    const result = parsePanelContributions([
      { id: 'a.b', title: 'First', command: 'a.b' },
      { id: 'a.b', title: 'Second', command: 'a.b' },
    ])

    expect(result.panels).toHaveLength(1)
    expect(result.panels[0]?.title).toBe('First')
    expect(result.failures[0]?.reason).toMatch(/duplicate panel id/)
  })

  it('reports the id of a failed entry when it has one', () => {
    const result = parsePanelContributions([{ id: 'a.b', title: '', command: 'a.b' }])

    expect(result.panels).toEqual([])
    expect(result.failures[0]?.id).toBe('a.b')
  })
})
