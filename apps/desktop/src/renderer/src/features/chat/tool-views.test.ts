import { describe, expect, it } from 'vitest'

import type { ChatMessage } from '@pictor/shared'

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
