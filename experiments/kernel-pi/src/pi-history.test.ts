import { describe, expect, it } from 'vitest'

import { historyRows, storedLevel, storedModel, textOf } from './pi-history.js'

/** One stored line, the way Pi writes it: `{type: 'message', message}`. */
function line(message: Record<string, unknown>, type = 'message'): Record<string, unknown> {
  return { type, message }
}

describe('textOf', () => {
  it('joins the text blocks and ignores the others', () => {
    expect(
      textOf([
        { type: 'thinking', thinking: '想一想' },
        { type: 'text', text: '前半' },
        { type: 'toolCall', id: 'c1', name: 'bash' },
        { type: 'text', text: '后半' },
      ]),
    ).toBe('前半后半')
  })

  it('takes a plain string as it is', () => {
    expect(textOf('就是一段话')).toBe('就是一段话')
    expect(textOf(undefined)).toBe('')
  })
})

describe('storedLevel', () => {
  it('takes the newest level the conversation recorded', () => {
    expect(
      storedLevel([
        { type: 'thinking_level_change', thinkingLevel: 'low' },
        line({ role: 'user', content: [{ type: 'text', text: '你好' }] }),
        { type: 'thinking_level_change', thinkingLevel: 'max' },
        line({ role: 'assistant', content: [{ type: 'text', text: '你好' }] }),
      ]),
    ).toBe('max')
  })

  it('says nothing rather than guessing', () => {
    // No level recorded, and a newest change Pictor does not recognise: both are
    // "unknown", which leaves the choice to Pi instead of naming a level it may not run.
    expect(storedLevel([])).toBeNull()
    expect(
      storedLevel([
        { type: 'thinking_level_change', thinkingLevel: 'low' },
        { type: 'thinking_level_change', thinkingLevel: 'ludicrous' },
      ]),
    ).toBeNull()
  })
})

describe('storedModel', () => {
  it('names the model the conversation last ran', () => {
    expect(
      storedModel([
        { type: 'model_change', provider: 'deepseek', modelId: 'deepseek-v4-pro' },
        line({ role: 'user', content: [{ type: 'text', text: '你好' }] }),
        { type: 'model_change', provider: 'deepseek', modelId: 'deepseek-flash' },
      ]),
    ).toBe('deepseek/deepseek-flash')
  })

  it('says nothing rather than guessing', () => {
    expect(storedModel([])).toBeNull()
    // A change with no model on it is not a model: an id invented here would show up
    // in the picker as a model that does not exist.
    expect(storedModel([{ type: 'model_change', provider: 'deepseek' }])).toBeNull()
  })
})

describe('historyRows', () => {
  it('reads a question and its answer back in order', () => {
    const rows = historyRows([
      line({ role: 'user', content: [{ type: 'text', text: '你好' }], timestamp: 1 }),
      line({ role: 'assistant', content: [{ type: 'text', text: '你好呀' }], timestamp: 2 }),
    ])

    expect(rows.map((row) => [row.role, row.text])).toEqual([
      ['user', '你好'],
      ['assistant', '你好呀'],
    ])
    expect(rows[0]?.timestamp).toBe(1)
  })

  it('gives thinking its own row, ahead of the answer it preceded', () => {
    const rows = historyRows([
      line({
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: '先算一下' },
          { type: 'text', text: '等于 2' },
        ],
      }),
    ])

    expect(rows.map((row) => [row.kind ?? null, row.text])).toEqual([
      ['thinking', '先算一下'],
      [null, '等于 2'],
    ])
  })

  it('puts a tool result on the row its call opened', () => {
    const rows = historyRows([
      line({
        role: 'assistant',
        content: [
          { type: 'text', text: '我跑一下' },
          { type: 'toolCall', id: 'call_1', name: 'bash', arguments: { command: 'echo hi' } },
        ],
      }),
      line({
        role: 'toolResult',
        toolCallId: 'call_1',
        toolName: 'bash',
        content: [{ type: 'text', text: 'hi\n' }],
        isError: false,
      }),
      line({ role: 'assistant', content: [{ type: 'text', text: '输出是 hi' }] }),
    ])

    expect(rows.map((row) => [row.role, row.toolName ?? null, row.text])).toEqual([
      ['assistant', null, '我跑一下'],
      ['tool', 'bash', 'hi\n'],
      ['assistant', null, '输出是 hi'],
    ])
    // The arguments came from the call, the output from the result: one row, both.
    expect(rows[1]?.input).toEqual({ command: 'echo hi' })
    expect(rows[1]?.toolCallId).toBe('call_1')
  })

  it('marks a failed tool call', () => {
    const rows = historyRows([
      line({ role: 'assistant', content: [{ type: 'toolCall', id: 'c9', name: 'read' }] }),
      line({
        role: 'toolResult',
        toolCallId: 'c9',
        toolName: 'read',
        content: [{ type: 'text', text: '没有这个文件' }],
        isError: true,
      }),
    ])

    expect(rows[0]?.isError).toBe(true)
    expect(rows[0]?.text).toBe('没有这个文件')
  })

  it('keeps a result whose call is missing from the file', () => {
    const rows = historyRows([
      line({
        role: 'toolResult',
        toolCallId: 'gone',
        toolName: 'bash',
        content: [{ type: 'text', text: '半个结果' }],
      }),
    ])

    expect(rows.map((row) => [row.role, row.toolName ?? null, row.text])).toEqual([
      ['tool', 'bash', '半个结果'],
    ])
  })

  it('keeps what the request cost, on a row of that message', () => {
    const rows = historyRows([
      line({ role: 'user', content: [{ type: 'text', text: '你好' }] }),
      line({
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: '想一想' },
          { type: 'text', text: '你好' },
        ],
        usage: { input: 38, output: 28, totalTokens: 1986 },
      }),
    ])

    expect(rows.at(-1)?.usage).toEqual({ input: 38, output: 28, total: 1986 })
    expect(rows.at(-2)?.usage).toBeUndefined()
  })

  it('keeps the count even when the message only called tools', () => {
    // The request that produced the calls is what the window was spent by, so the
    // count does not depend on the model having said anything.
    const rows = historyRows([
      line({
        role: 'assistant',
        content: [{ type: 'toolCall', id: 'c1', name: 'bash', arguments: { command: 'ls' } }],
        usage: { input: 7, output: 3, totalTokens: 10 },
      }),
    ])

    expect(rows.map((row) => row.usage)).toEqual([{ input: 7, output: 3, total: 10 }])
  })

  it('drops the bookkeeping lines and the empty messages', () => {
    const rows = historyRows([
      line({ role: 'system', content: '你是助手' }),
      { type: 'model_change', provider: 'deepseek', modelId: 'x' },
      line({ role: 'user', content: [] }),
      line({ role: 'user', content: [{ type: 'text', text: '真正的提问' }] }),
    ])

    expect(rows.map((row) => row.text)).toEqual(['真正的提问'])
  })
  it('keeps a compaction as a row of its own, without inventing a saving', () => {
    // Pi's entry records what the context held before, not after; claiming a saving
    // would be inventing the second number.
    const rows = historyRows([
      {
        type: 'compaction',
        summary: '前面聊过颜色',
        firstKeptEntryId: 'e9',
        tokensBefore: 60_000,
        timestamp: 1700000000000,
      },
      line({ role: 'user', content: [{ type: 'text', text: '接着来' }] }),
    ])

    expect(rows[0]).toMatchObject({
      role: 'notice',
      timestamp: 1700000000000,
      notice: { kind: 'compaction', savedTokens: null, summary: '前面聊过颜色' },
    })
    expect(rows.map((row) => row.role)).toEqual(['notice', 'user'])
  })
})
