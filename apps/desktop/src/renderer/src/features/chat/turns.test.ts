import { describe, expect, it } from 'vitest'

import type { ChatMessage } from '@pictor/shared'

import { buildTurns, groupActivityItems } from './turns.js'

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

  it('carries the event boundary of each block, for branching from it', () => {
    const turns = buildTurns([
      msg({ id: 'u1', role: 'user', text: '问', timestamp: 100, seq: 4 }),
      msg({ id: 'a1', role: 'assistant', text: '答', timestamp: 200, seq: 7 }),
    ])

    expect(turns[0]?.user?.seq).toBe(4)
    expect(turns[0]?.parts[0]).toMatchObject({ kind: 'text', text: '答', fork: { seq: 7 } })
    expect(turns[0]?.endSeq).toBe(7)
    // Nothing precedes the first turn, so only the second one can branch before it.
    expect(turns[0]?.before).toBeNull()
    expect(
      buildTurns([
        msg({ id: 'u1', role: 'user', text: '问一', seq: 4 }),
        msg({ id: 'a1', role: 'assistant', text: '答一', seq: 7 }),
        msg({ id: 'u2', role: 'user', text: '问二', seq: 9 }),
      ])[1]?.before,
    ).toEqual({ seq: 7 })
  })

  it('branches at the question itself when the kernel forks by entry id', () => {
    // Pi cuts at a user message, so the row's own id is the point — not the
    // boundary the previous turn happened to end on.
    const turns = buildTurns([
      msg({ id: 'u1', role: 'user', text: '第一问', forkId: 'entry-1' }),
      msg({ id: 'a1', role: 'assistant', text: '第一答' }),
      msg({ id: 'u2', role: 'user', text: '第二问', forkId: 'entry-2' }),
    ])

    // The first question of a page inherits nothing, so it is not a fork point.
    expect(turns[0]?.before).toBeNull()
    expect(turns[1]?.before).toEqual({ id: 'entry-2' })
    // An answer is not a fork point for that kernel: it has no entry id of its own.
    expect(turns[0]?.parts[0]).toEqual({ kind: 'text', id: 'text-a1', text: '第一答' })
  })

  it('keeps reasoning inside the activity group and out of the answer', () => {
    const turns = buildTurns([
      msg({ id: 'u1', role: 'user', text: '问题' }),
      msg({ id: 't1', role: 'assistant', kind: 'thinking', text: '先想' }),
      msg({ id: 't2', role: 'assistant', kind: 'thinking', text: '再想' }),
      msg({ id: 'a1', role: 'assistant', text: '回答' }),
    ])

    const parts = turns[0]?.parts ?? []
    expect(parts.map((part) => part.kind)).toEqual(['activity', 'text'])
    expect(parts[0]?.kind === 'activity' && parts[0].messages.map((m) => m.id)).toEqual([
      't1',
      't2',
    ])
    // Reasoning must not leak into the answer summary.
    expect(turns[0]?.answer).toBe('回答')
  })

  it('keeps reasoning and tool calls in one group, in order', () => {
    const turns = buildTurns([
      msg({ id: 'u1', role: 'user', text: '问题' }),
      msg({ id: 't1', role: 'assistant', kind: 'thinking', text: '先想' }),
      msg({ id: 'x1', role: 'tool', toolName: 'read', text: 'a' }),
      msg({ id: 't2', role: 'assistant', kind: 'thinking', text: '再想' }),
      msg({ id: 'x2', role: 'tool', toolName: 'bash', text: 'b' }),
      msg({ id: 'a1', role: 'assistant', text: '回答' }),
    ])

    const parts = turns[0]?.parts ?? []
    expect(parts.map((part) => part.kind)).toEqual(['activity', 'text'])
    expect(parts[0]?.kind === 'activity' && parts[0].messages.map((m) => m.id)).toEqual([
      't1',
      'x1',
      't2',
      'x2',
    ])
  })

  it('splits activity that a text block interrupts', () => {
    const turns = buildTurns([
      msg({ id: 'u1', role: 'user', text: '问题' }),
      msg({ id: 'x1', role: 'tool', toolName: 'read', text: 'a' }),
      msg({ id: 'a1', role: 'assistant', text: '中间说明' }),
      msg({ id: 'x2', role: 'tool', toolName: 'bash', text: 'b' }),
    ])

    expect((turns[0]?.parts ?? []).map((part) => part.kind)).toEqual([
      'activity',
      'text',
      'activity',
    ])
  })

  it('keeps a reply that arrives without a loaded prompt', () => {
    const turns = buildTurns([msg({ id: 'a1', role: 'assistant', text: '只有回答' })])

    expect(turns).toHaveLength(1)
    expect(turns[0]).toMatchObject({ user: null, prompt: '', answer: '只有回答' })
  })
})

describe('groupActivityItems', () => {
  it('merges neighbouring reasoning into one row', () => {
    const items = groupActivityItems([
      msg({ id: 't1', role: 'assistant', kind: 'thinking', text: '先想' }),
      msg({ id: 't2', role: 'assistant', kind: 'thinking', text: '再想' }),
    ])

    expect(items).toEqual([{ kind: 'thinking', id: 'thinking-t1', text: '先想再想' }])
  })

  it('keeps reasoning and tool calls in the order they arrived', () => {
    const items = groupActivityItems([
      msg({ id: 't1', role: 'assistant', kind: 'thinking', text: '想' }),
      msg({ id: 'x1', role: 'tool', toolName: 'read', text: 'a' }),
      msg({ id: 't2', role: 'assistant', kind: 'thinking', text: '又想' }),
    ])

    expect(items.map((item) => item.kind)).toEqual(['thinking', 'tool', 'thinking'])
  })
})
