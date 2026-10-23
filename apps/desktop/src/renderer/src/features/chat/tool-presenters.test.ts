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
        input: { path: '/repo/docs/ARCHITECTURE.md' },
        text: '# Architecture',
      }),
    )

    expect(view.label).toBe('阅读')
    expect(view.target).toBe('ARCHITECTURE.md')
    expect(view.sections).toEqual([{ title: '文件内容', body: '# Architecture' }])
  })

  it('unwraps the read payload and captions the window it returned', () => {
    const view = presentTool(
      call({
        toolName: 'read',
        input: { path: '/repo/src/app.ts' },
        text: '<path>/repo/src/app.ts</path>\n<type>file</type>\n<content>\n1: const a = 1\n2: const b = 2\n\n(Showing lines 1-2 of 40. Use offset=3 to continue.)\n</content>',
      }),
    )

    expect(view.sections).toEqual([
      {
        title: '文件内容 · 第 1-2 行 / 共 40 行',
        body: '1: const a = 1\n2: const b = 2',
      },
    ])
  })

  it('leaves a payload without the wrapper alone', () => {
    const view = presentTool(call({ toolName: 'read', text: 'plain body' }))

    expect(view.sections).toEqual([{ title: '文件内容', body: 'plain body' }])
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

  it('turns an edit into a colourised diff plus the result', () => {
    const view = presentTool(
      call({
        toolName: 'edit',
        input: { path: 'src/a.ts', edits: [{ oldText: 'const a = 1', newText: 'const a = 2' }] },
        text: 'ok',
      }),
    )

    expect(view.label).toBe('编辑')
    expect(view.target).toBe('a.ts')
    expect(view.sections.map((section) => section.title)).toEqual(['修改', '结果'])

    const diff = view.sections[0]
    expect(diff?.format).toBe('diff')
    expect(diff?.body.split('\n')).toEqual(['-const a = 1', '+const a = 2'])
  })

  it('prefers the diff the edit tool reported over one rebuilt from arguments', () => {
    const view = presentTool(
      call({
        toolName: 'edit',
        input: { path: 'a.txt', edits: [{ oldText: 'beta', newText: 'BETA' }] },
        text: 'ok',
        diff: ' 1 alpha\n-2 beta\n+2 BETA',
      }),
    )

    expect(view.sections[0]).toEqual({
      title: '修改',
      body: ' 1 alpha\n-2 beta\n+2 BETA',
      format: 'diff',
    })
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
