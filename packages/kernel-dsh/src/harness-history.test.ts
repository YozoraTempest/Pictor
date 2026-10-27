import { describe, expect, it } from 'vitest'

import { loadHarnessHistory, projectHarnessEvents } from './harness-history.js'
import { DSH } from '@vulonlok/harness-dsh'

const userMessage = (id: string, text: string, kind = 'user') => ({
  type: 'user/message',
  seq: 1,
  time: 1000,
  data: { id, source: { kind }, content: [{ type: 'text', text }] },
})

const assistantMessage = (text: string) => ({
  type: 'assistant/message',
  seq: 2,
  time: 2000,
  data: { message: { role: 'assistant', content: [{ type: 'text', text }] } },
})

describe('projectHarnessEvents', () => {
  it('keeps the count the runtime reported for the step', () => {
    // dsh files its usage beside the message, on the event itself.
    const messages = projectHarnessEvents([
      userMessage('m1', 'ping'),
      {
        ...assistantMessage('pong'),
        data: {
          ...assistantMessage('pong').data,
          usage: { inputTokens: 713, outputTokens: 2, totalTokens: 8779 },
        },
      },
    ])

    expect(messages.at(-1)?.usage).toEqual({ input: 713, output: 2, total: 8779 })
  })

  it('leaves the count off a step that did not report one', () => {
    const messages = projectHarnessEvents([assistantMessage('pong')])

    expect(messages[0]?.usage).toBeUndefined()
  })

  it("keeps the user's own words and drops injected runtime context", () => {
    const messages = projectHarnessEvents([
      userMessage('m1', 'ping'),
      userMessage('ctx', 'Current runtime context. This snapshot supersedes…', 'runtime-context'),
      userMessage('reminder', '<system-reminder>skills…</system-reminder>', 'runtime-context'),
      assistantMessage('pong'),
    ])

    expect(messages.map((message) => [message.role, message.text])).toEqual([
      ['user', 'ping'],
      ['assistant', 'pong'],
    ])
  })

  it('keeps the event sequence so a row can be a fork point', () => {
    const messages = projectHarnessEvents([userMessage('m1', 'ping'), assistantMessage('pong')])

    expect(messages.map((message) => message.seq)).toEqual([1, 2])
  })

  it('shows one row per tool call, filled in by its result', () => {
    const messages = projectHarnessEvents([
      userMessage('m1', 'read the file'),
      {
        type: DSH.tool.call,
        seq: 3,
        time: 3000,
        data: { callId: 'c1', name: 'read', arguments: { path: 'a.ts' } },
      },
      {
        type: DSH.tool.result,
        seq: 4,
        time: 4000,
        data: { callId: 'c1', name: 'read', output: 'body' },
      },
    ])

    const tool = messages.find((message) => message.role === 'tool')
    expect(tool).toMatchObject({
      toolName: 'read',
      text: 'body',
      isError: false,
      input: { path: 'a.ts' },
    })
    expect(messages.filter((message) => message.role === 'tool')).toHaveLength(1)
  })

  it('files a compaction as its own row, with what it saved', () => {
    const messages = projectHarnessEvents([
      userMessage('m1', 'ping'),
      assistantMessage('pong'),
      {
        type: 'compaction/summary',
        seq: 5,
        time: 6000,
        data: {
          compactionId: 'k1',
          summary: '前面聊过 ping',
          shadowedRange: [1, 2],
          shadowedTokenCount: 4200,
        },
      },
    ])

    // A summary is durable, so a reopened conversation still says where it lost detail.
    expect(messages.at(-1)).toMatchObject({
      role: 'notice',
      seq: 5,
      notice: { kind: 'compaction', savedTokens: 4200, summary: '前面聊过 ping' },
    })
  })

  it('draws no row for a pruned tool result', () => {
    // Every large tool output is pruned on its own; a divider per one would bury the
    // conversation under them.
    const messages = projectHarnessEvents([
      userMessage('m1', 'ping'),
      {
        type: 'compaction/prune',
        seq: 6,
        time: 7000,
        data: { shadowedRange: [3, 3], shadowedSeqs: [3], shadowedTokenCount: 900 },
      },
    ])

    expect(messages.map((message) => message.role)).toEqual(['user'])
  })

  it('does not repeat a user message that the inbox also logged', () => {
    const message = userMessage('m1', 'ping')
    const messages = projectHarnessEvents([message, { ...message, seq: 9 }])

    expect(messages).toHaveLength(1)
  })
})

describe('loadHarnessHistory', () => {
  it('pages from the newest message backwards, like the Pi reader', () => {
    const events = [
      userMessage('m1', 'one'),
      assistantMessage('first'),
      userMessage('m2', 'two'),
      assistantMessage('second'),
    ]

    const page = loadHarnessHistory(events, 2, 0)
    expect(page.messages.map((message) => message.text)).toEqual(['two', 'second'])
    expect(page.hasMore).toBe(true)

    const older = loadHarnessHistory(events, 2, page.nextOffset)
    expect(older.messages.map((message) => message.text)).toEqual(['one', 'first'])
    expect(older.hasMore).toBe(false)
  })

  it('returns an empty page when there is no history', () => {
    expect(loadHarnessHistory([], 50, 0)).toEqual({ messages: [], nextOffset: 0, hasMore: false })
  })
})

/** The stored tool result, in the shape the runtime actually writes it. */
describe('tool/result as the runtime writes it', () => {
  it('reads the answer out of the message it carries', () => {
    // The event's own fields carry the call id; the content and the error flag live on
    // the message inside it. Reading only the top level lost every tool output on reload.
    const messages = projectHarnessEvents([
      userMessage('m1', 'run it'),
      {
        type: DSH.tool.call,
        seq: 3,
        time: 3000,
        data: { callId: 'c1', name: 'bash', arguments: '{"command":"echo hi"}' },
      },
      {
        type: DSH.tool.result,
        seq: 4,
        time: 4000,
        data: {
          turn: 1,
          step: 1,
          message: {
            role: 'tool',
            toolCallId: 'c1',
            content: [{ type: 'text', text: 'hi\n' }],
            isError: false,
          },
          meta: { cwd: '/tmp' },
        },
      },
    ])

    const tool = messages.find((message) => message.role === 'tool')
    expect(tool).toMatchObject({ toolName: 'bash', text: 'hi\n', isError: false })
    // One row per call: the result fills in the row its call opened.
    expect(messages.filter((message) => message.role === 'tool')).toHaveLength(1)
  })

  it('keeps a failure a failure when the message says so', () => {
    const messages = projectHarnessEvents([
      {
        type: DSH.tool.call,
        seq: 3,
        time: 3000,
        data: { callId: 'c1', name: 'bash', arguments: '{}' },
      },
      {
        type: DSH.tool.result,
        seq: 4,
        time: 4000,
        data: {
          message: {
            role: 'tool',
            toolCallId: 'c1',
            content: [{ type: 'text', text: 'exit code: 1' }],
            isError: true,
          },
        },
      },
    ])

    expect(messages.find((message) => message.role === 'tool')).toMatchObject({
      text: 'exit code: 1',
      isError: true,
    })
  })
})
