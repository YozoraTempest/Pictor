import { describe, expect, it } from 'vitest'

import type { ChatMessage } from '@pictor/shared'

import { buildTurns } from './turns.js'

function msg(partial: Partial<ChatMessage> & Pick<ChatMessage, 'id' | 'role'>): ChatMessage {
  return { text: '', timestamp: null, ...partial }
}

describe('buildTurns', () => {
  it('starts a turn on each prompt and keeps the reply with it', () => {
    const turns = buildTurns([
      msg({ id: 'u1', role: 'user', text: '第一个问题', timestamp: 100 }),
      msg({ id: 'a1', role: 'assistant', text: '第一个回答', timestamp: 200 }),
      msg({ id: 'u2', role: 'user', text: '第二个问题', timestamp: 300 }),
      msg({ id: 'a2', role: 'assistant', text: '第二个回答', timestamp: 400 }),
    ])

    expect(turns).toHaveLength(2)
    expect(turns[0]).toMatchObject({
      prompt: '第一个问题',
      answer: '第一个回答',
      startedAt: 100,
      finishedAt: 200,
    })
    expect(turns[1]).toMatchObject({ prompt: '第二个问题', answer: '第二个回答' })
  })

  it('keeps reasoning and answer as separate parts', () => {
    const turns = buildTurns([
      msg({ id: 'u1', role: 'user', text: '问题' }),
      msg({ id: 't1', role: 'assistant', kind: 'thinking', text: '先想' }),
      msg({ id: 't2', role: 'assistant', kind: 'thinking', text: '再想' }),
      msg({ id: 'a1', role: 'assistant', text: '回答' }),
    ])

    expect(turns[0]?.parts).toEqual([
      { kind: 'thinking', id: 'thinking-t1', text: '先想再想' },
      { kind: 'text', id: 'text-a1', text: '回答' },
    ])
    // Reasoning must not leak into the answer summary.
    expect(turns[0]?.answer).toBe('回答')
  })

  it('merges adjacent tool calls into one group', () => {
    const turns = buildTurns([
      msg({ id: 'u1', role: 'user', text: '问题' }),
      msg({ id: 'x1', role: 'tool', toolName: 'read', text: 'a' }),
      msg({ id: 'x2', role: 'tool', toolName: 'bash', text: 'b' }),
      msg({ id: 'a1', role: 'assistant', text: '回答' }),
    ])

    const parts = turns[0]?.parts ?? []
    expect(parts).toHaveLength(2)
    expect(parts[0]).toMatchObject({ kind: 'tools' })
    expect(parts[0]?.kind === 'tools' && parts[0].messages.map((m) => m.toolName)).toEqual([
      'read',
      'bash',
    ])
    expect(parts[1]).toMatchObject({ kind: 'text', text: '回答' })
  })

  it('splits tool groups that a text block interrupts', () => {
    const turns = buildTurns([
      msg({ id: 'u1', role: 'user', text: '问题' }),
      msg({ id: 'x1', role: 'tool', toolName: 'read', text: 'a' }),
      msg({ id: 'a1', role: 'assistant', text: '中间说明' }),
      msg({ id: 'x2', role: 'tool', toolName: 'bash', text: 'b' }),
    ])

    expect((turns[0]?.parts ?? []).map((part) => part.kind)).toEqual(['tools', 'text', 'tools'])
  })

  it('keeps a reply that arrives without a loaded prompt', () => {
    const turns = buildTurns([msg({ id: 'a1', role: 'assistant', text: '只有回答' })])

    expect(turns).toHaveLength(1)
    expect(turns[0]).toMatchObject({ user: null, prompt: '', answer: '只有回答' })
  })
})
