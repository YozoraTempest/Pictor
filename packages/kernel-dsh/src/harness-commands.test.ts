import { describe, expect, it } from 'vitest'

import { commandTextOf, parseCommands } from './harness-commands.js'

describe('parseCommands', () => {
  it('keeps the name, sentence and input hint the runtime sent', () => {
    const commands = parseCommands([
      { name: 'compact', description: '压缩上下文', input: { placeholder: '关注点' } },
      { name: 'permission', description: '切换沙箱模式' },
    ])

    expect(commands).toEqual([
      { name: 'compact', description: '压缩上下文', input: '关注点' },
      { name: 'permission', description: '切换沙箱模式' },
    ])
  })

  it('drops entries a menu could not draw, instead of throwing', () => {
    // The runtime is on its own version: a renamed field has to cost the menu one
    // row, not the whole popup.
    expect(parseCommands([{ description: '没有名字' }, null, 'compact', { name: '  ' }])).toEqual(
      [],
    )
  })

  it('names a command that arrived without a description', () => {
    expect(parseCommands([{ name: 'goal' }])).toEqual([{ name: 'goal', description: '/goal' }])
  })

  it('answers empty for a payload that is not a list at all', () => {
    expect(parseCommands(null)).toEqual([])
    expect(parseCommands({ ok: true })).toEqual([])
  })
})

describe('commandTextOf', () => {
  it('returns what the command said', () => {
    expect(
      commandTextOf({ commandId: 'c1', result: { kind: 'success', text: '上下文已压缩' } }),
    ).toBe('上下文已压缩')
  })

  it('names a refusal that carried no words', () => {
    // A silent refusal would read as a button that did nothing.
    expect(commandTextOf({ commandId: 'c2', result: { kind: 'error' } })).toBe('命令没有完成')
  })

  it('says nothing when a successful command said nothing', () => {
    expect(commandTextOf({ commandId: 'c3', result: { kind: 'success' } })).toBeNull()
    expect(commandTextOf(null)).toBeNull()
    expect(commandTextOf({})).toBeNull()
  })
})
