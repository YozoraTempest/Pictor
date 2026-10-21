import { describe, expect, it } from 'vitest'

import { parseToolViewContribution, parseToolViewContributions } from './tool-views.js'

describe('parseToolViewContribution', () => {
  it('keeps a view with a label and an icon', () => {
    expect(
      parseToolViewContribution({
        id: 'web.fetch',
        tools: ['fetch'],
        label: '抓取',
        icon: 'globe',
      }),
    ).toEqual({ id: 'web.fetch', tools: ['fetch'], label: '抓取', icon: 'globe' })
  })

  it('accepts a view that only names the tools', () => {
    expect(parseToolViewContribution({ id: 'mine', tools: ['read', 'write'] })).toEqual({
      id: 'mine',
      tools: ['read', 'write'],
    })
  })

  it('rejects a view without tools', () => {
    expect(() => parseToolViewContribution({ id: 'mine', tools: [] })).toThrow(/tools is empty/)
  })

  it('rejects a malformed tool name', () => {
    expect(() => parseToolViewContribution({ id: 'mine', tools: ['Read File'] })).toThrow(
      /invalid tool name/,
    )
  })

  it('rejects an icon that is not kebab-case', () => {
    expect(() =>
      parseToolViewContribution({ id: 'mine', tools: ['read'], icon: 'FileText' }),
    ).toThrow(/kebab-case/)
  })

  it('rejects an over-long label', () => {
    expect(() =>
      parseToolViewContribution({ id: 'mine', tools: ['read'], label: 'x'.repeat(25) }),
    ).toThrow(/longer than 24/)
  })
})

describe('parseToolViewContributions', () => {
  it('keeps the good views and reports the bad ones', () => {
    const { views, failures } = parseToolViewContributions([
      { id: 'good', tools: ['read'] },
      { id: 'bad', tools: [] },
    ])

    expect(views.map((view) => view.id)).toEqual(['good'])
    expect(failures).toHaveLength(1)
    expect(failures[0]?.id).toBe('bad')
  })

  it('lets the first view of a tool win', () => {
    const { views, failures } = parseToolViewContributions([
      { id: 'first', tools: ['read'], label: '阅读' },
      { id: 'second', tools: ['read'], label: '偷换' },
    ])

    expect(views.map((view) => view.id)).toEqual(['first'])
    expect(failures[0]?.reason).toContain('tool already has a view: read')
  })

  it('reports duplicate ids', () => {
    const { views, failures } = parseToolViewContributions([
      { id: 'same', tools: ['read'] },
      { id: 'same', tools: ['write'] },
    ])

    expect(views).toHaveLength(1)
    expect(failures[0]?.reason).toContain('duplicate tool view id')
  })
})
