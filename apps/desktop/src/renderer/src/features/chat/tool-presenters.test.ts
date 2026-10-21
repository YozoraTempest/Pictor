import { describe, expect, it } from 'vitest'

import type { ChatMessage } from '@pictor/shared'

import { presentTool, registerToolPresenter, toolLabel } from './tool-presenters.js'

function call(partial: Partial<ChatMessage> & Pick<ChatMessage, 'toolName'>): ChatMessage {
  return { id: 'x', role: 'tool', text: 'output', timestamp: null, ...partial }
}

describe('presentTool', () => {
  it('presents read as an action on a file with its content', () => {
    const view = presentTool(
      call({
        toolName: 'read',
        input: { file_path: '/repo/docs/ARCHITECTURE.md' },
        text: '# Architecture',
      }),
    )

    expect(view.label).toBe('阅读')
    expect(view.target).toBe('ARCHITECTURE.md')
    expect(view.sections).toEqual([{ title: '文件内容', body: '# Architecture' }])
  })

  it('presents bash with the command it ran and its output', () => {
    const view = presentTool(
      call({ toolName: 'bash', input: { command: 'ls -la' }, text: 'total 0' }),
    )

    expect(view.label).toBe('运行')
    expect(view.target).toBe('ls -la')
    expect(view.sections).toEqual([
      { title: '执行的命令', body: 'ls -la' },
      { title: '输出', body: 'total 0' },
    ])
  })

  it('turns an edit into before/after sections a diff can grow from', () => {
    const view = presentTool(
      call({
        toolName: 'edit',
        input: { file_path: 'src/a.ts', old_string: 'const a = 1', new_string: 'const a = 2' },
        text: 'ok',
      }),
    )

    expect(view.label).toBe('编辑')
    expect(view.target).toBe('a.ts')
    expect(view.sections.map((section) => section.title)).toEqual(['原内容', '新内容', '结果'])
  })

  it('falls back to raw arguments and output for an unknown tool', () => {
    const view = presentTool(call({ toolName: 'mystery', input: { q: 1 }, text: 'done' }))

    expect(view.label).toBe('mystery')
    expect(view.target).toBe('')
    expect(view.sections.map((section) => section.title)).toEqual(['入参', '出参'])
    expect(view.sections[0]?.body).toContain('"q": 1')
  })

  it('labels a blocked call output as the reason', () => {
    const view = presentTool(call({ toolName: 'mystery', input: { q: 1 }, blocked: true }))

    expect(view.sections.at(-1)?.title).toBe('拦截原因')
  })
})

describe('toolLabel', () => {
  it('maps a known tool to its display name', () => {
    expect(toolLabel('read')).toBe('阅读')
    expect(toolLabel('bash')).toBe('运行')
  })

  it('keeps the raw name for a tool without a presenter', () => {
    expect(toolLabel('mystery')).toBe('mystery')
  })
})

describe('registerToolPresenter', () => {
  it('lets a tool define its own presentation and can be undone', () => {
    const dispose = registerToolPresenter('deploy', (message) => ({
      label: '部署',
      target: 'production',
      sections: [{ title: '结果', body: message.text }],
    }))

    expect(presentTool(call({ toolName: 'deploy', text: 'ok' }))).toEqual({
      label: '部署',
      target: 'production',
      sections: [{ title: '结果', body: 'ok' }],
    })

    dispose()

    // Back to the generic fallback once the contributor goes away.
    expect(presentTool(call({ toolName: 'deploy', text: 'ok' })).label).toBe('deploy')
  })
})
