import { describe, expect, it } from 'vitest'

import type { ChatMessage } from '@vulonlok/shared'

import { presentTool } from './tool-presenters.js'
import { applyToolViews, iconForName } from './tool-views.js'

function call(toolName: string, input: unknown, text: string): ChatMessage {
  return { id: 'x', role: 'tool', toolName, text, timestamp: null, input }
}

describe('iconForName', () => {
  it('maps a contributed name to a renderer icon', () => {
    expect(iconForName('globe')).not.toBeUndefined()
  })

  it('leaves an unknown name to the fallback', () => {
    expect(iconForName('not-an-icon')).toBeUndefined()
    expect(iconForName(undefined)).toBeUndefined()
  })
})

describe('applyToolViews', () => {
  it('overrides the label and icon but keeps the sections a tool defines', () => {
    const dispose = applyToolViews([{ id: 'mine', tools: ['bash'], label: '执行', icon: 'hammer' }])

    const view = presentTool(call('bash', { command: 'ls -la' }, 'total 0'))

    expect(view.label).toBe('执行')
    expect(view.icon).toBe(iconForName('hammer'))
    // The command and its output stay exactly what the built-in presenter gave.
    expect(view.target).toBe('ls -la')
    expect(view.sections.map((section) => section.title)).toEqual(['执行的命令', '输出'])

    dispose()
    expect(presentTool(call('bash', { command: 'ls' }, 'ok')).label).toBe('运行')
  })

  it('gives an unknown tool a presenter instead of leaving it generic', () => {
    const dispose = applyToolViews([{ id: 'web', tools: ['fetch'], label: '抓取', icon: 'globe' }])

    const view = presentTool(call('fetch', { url: 'x' }, 'done'))

    expect(view.label).toBe('抓取')
    expect(view.sections.map((section) => section.title)).toEqual(['入参', '出参'])

    dispose()
    expect(presentTool(call('fetch', {}, 'done')).label).toBe('fetch')
  })
})

/** A namespace view is the reason a view may be a pattern instead of a name. */
describe('wildcard tool views', () => {
  it('dresses every tool of a namespace nobody enumerated', () => {
    const dispose = applyToolViews([
      { id: 'github', tools: ['mcp__github__*'], label: 'GitHub', icon: 'git-branch' },
    ])

    const view = presentTool(call('mcp__github__create_issue', { title: 'x' }, 'opened #1'))

    expect(view.label).toBe('GitHub')
    // The tool's own sections survive: a view is presentation, not rendering.
    expect(view.sections.length).toBeGreaterThan(0)
    dispose()
  })

  it('lets an exact name win over the namespace it belongs to', () => {
    const dispose = applyToolViews([
      { id: 'github', tools: ['mcp__github__*'], label: 'GitHub' },
      { id: 'issues', tools: ['mcp__github__create_issue'], label: '建 issue' },
    ])

    expect(presentTool(call('mcp__github__create_issue', {}, 'ok')).label).toBe('建 issue')
    expect(presentTool(call('mcp__github__list_issues', {}, 'ok')).label).toBe('GitHub')
    dispose()
  })

  it('prefers the narrower prefix when two namespaces match', () => {
    const dispose = applyToolViews([
      { id: 'mcp', tools: ['mcp__*'], label: '外部工具' },
      { id: 'github', tools: ['mcp__github__*'], label: 'GitHub' },
      { id: 'gitlab', tools: ['mcp__gitlab__*'], label: 'GitLab' },
    ])

    expect(presentTool(call('mcp__gitlab__mr', {}, 'ok')).label).toBe('GitLab')
    expect(presentTool(call('mcp__other__thing', {}, 'ok')).label).toBe('外部工具')
    dispose()
  })

  it('forgets a view once it is disposed', () => {
    const dispose = applyToolViews([{ id: 'github', tools: ['mcp__github__*'], label: 'GitHub' }])
    dispose()

    // Nothing left to match: the tool reads as itself again.
    expect(presentTool(call('mcp__github__create_issue', {}, 'ok')).label).not.toBe('GitHub')
  })
})
