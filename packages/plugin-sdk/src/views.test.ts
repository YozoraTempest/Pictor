import { describe, expect, it } from 'vitest'

import { VIEW_LIMITS, parseViewContributions, parseViewSpec } from './views.js'

/**
 * A view is drawn by the window, so this validator is the boundary: everything it lets
 * through has a renderer behind it, and everything it refuses is a plugin asking for one
 * that does not exist. The cases below are that whole vocabulary.
 */
describe('parseViewSpec', () => {
  it('keeps every block kind it draws', () => {
    const spec = parseViewSpec({
      blocks: [
        { kind: 'heading', text: '标题' },
        { kind: 'text', text: '一段话' },
        { kind: 'markdown', text: '**粗**' },
        { kind: 'list', items: ['一', '二'], ordered: true },
        { kind: 'keyValue', rows: [{ label: '分支', value: 'main' }] },
        { kind: 'table', columns: ['a', 'b'], rows: [['1', '2']] },
        { kind: 'code', text: 'ls -la', language: 'bash' },
        { kind: 'badge', label: '3 个改动', tone: 'accent' },
        { kind: 'divider' },
      ],
      note: '读取于 12:00',
    })

    expect(spec.blocks).toHaveLength(9)
    expect(spec.note).toBe('读取于 12:00')
  })

  it('refuses a block this window cannot draw', () => {
    // Silently dropping it would leave a panel that lost half its content and looked fine.
    expect(() => parseViewSpec({ blocks: [{ kind: 'chart', series: [] }] })).toThrow(
      /not one this window draws: chart/,
    )
    expect(() => parseViewSpec({ blocks: [{}] })).toThrow(/\(missing\)/)
  })

  it('refuses a table whose rows do not match its header', () => {
    expect(() =>
      parseViewSpec({ blocks: [{ kind: 'table', columns: ['a', 'b'], rows: [['1']] }] }),
    ).toThrow(/has 1 cells, want 2/)
  })

  it('refuses an unknown badge tone', () => {
    expect(() => parseViewSpec({ blocks: [{ kind: 'badge', label: 'x', tone: 'pink' }] })).toThrow(
      /tone must be one of/,
    )
  })

  it('bounds what one panel can ask the window to draw', () => {
    const many = Array.from({ length: VIEW_LIMITS.blocks + 1 }, () => ({ kind: 'divider' }))
    expect(() => parseViewSpec({ blocks: many })).toThrow(/more than 200 entries/)
    expect(() =>
      parseViewSpec({ blocks: [{ kind: 'text', text: 'x'.repeat(VIEW_LIMITS.text + 1) }] }),
    ).toThrow(/longer than 20000/)
    expect(() => parseViewSpec({ note: 'x'.repeat(VIEW_LIMITS.note + 1), blocks: [] })).toThrow(
      /view\.note is longer/,
    )
  })

  it('refuses a view that is not a description at all', () => {
    expect(() => parseViewSpec('hello')).toThrow(/must be an object with blocks/)
    expect(() => parseViewSpec({ blocks: 'no' })).toThrow(/view\.blocks must be an array/)
  })
})

describe('parseViewContributions', () => {
  it('keeps what it can and names what it cannot', () => {
    const { views, failures } = parseViewContributions([
      { id: 'acme.status', title: '状态', data: () => ({ blocks: [] }) },
      { id: 'acme.broken', title: '坏' },
      { id: 'acme.status', title: '重名', data: () => ({ blocks: [] }) },
      { id: 'acme.bad-icon', title: '图标', icon: 'Not An Icon', data: () => ({ blocks: [] }) },
    ])

    expect(views.map((view) => view.id)).toEqual(['acme.status'])
    expect(failures.map((failure) => failure.id)).toEqual([
      'acme.broken',
      'acme.status',
      'acme.bad-icon',
    ])
    expect(failures[0]?.reason).toMatch(/data must be a function/)
  })
})
