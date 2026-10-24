import { describe, expect, it } from 'vitest'

import { HarnessChatBridge } from './harness-chat.js'

/** Build the notification shape the runtime actually sends. */
function sessionEvent(type: string, data: Record<string, unknown>, sessionId = 's1') {
  return {
    method: 'session.event',
    params: { sessionId, event: { type, seq: 1, time: 0, data } },
  }
}

describe('HarnessChatBridge', () => {
  it('opens a run on turn/start and names it after the turn', () => {
    const bridge = new HarnessChatBridge()

    // The sequence is the fork boundary a question can be branched from.
    expect(bridge.map(sessionEvent('turn/start', { turn: 3 }))).toEqual([
      { type: 'run.started', sessionId: 's1', runId: 't3', seq: 1 },
    ])
  })

  it('turns an assistant message into the text the transcript appends', () => {
    const bridge = new HarnessChatBridge()
    bridge.map(sessionEvent('turn/start', { turn: 1 }))

    const events = bridge.map(
      sessionEvent('assistant/message', {
        turn: 1,
        step: 1,
        message: {
          role: 'assistant',
          content: [
            { type: 'text', text: 'pong ' },
            { type: 'text', text: 'from mock' },
          ],
        },
      }),
    )

    expect(events).toEqual([
      { type: 'message.delta', sessionId: 's1', runId: 't1', text: 'pong from mock' },
    ])
  })

  it('reports tool calls and their results', () => {
    const bridge = new HarnessChatBridge()
    bridge.map(sessionEvent('turn/start', { turn: 2 }))

    expect(
      bridge.map(
        sessionEvent('tool/call', {
          turn: 2,
          step: 1,
          callId: 'call-1',
          name: 'read',
          arguments: JSON.stringify({ path: 'a.ts' }),
        }),
      ),
    ).toEqual([
      { type: 'tool.started', sessionId: 's1', runId: 't2', tool: 'read', input: { path: 'a.ts' } },
    ])

    expect(
      bridge.map(
        sessionEvent('tool/result', {
          turn: 2,
          step: 1,
          message: {
            role: 'tool',
            toolCallId: 'call-1',
            content: [{ type: 'text', text: 'file body' }],
          },
        }),
      ),
    ).toMatchObject([{ type: 'tool.finished', tool: 'read', isError: false, output: 'file body' }])
  })

  it('closes the run on turn/end and forgets its id', () => {
    const bridge = new HarnessChatBridge()
    bridge.map(sessionEvent('turn/start', { turn: 4 }))

    expect(
      bridge.map(sessionEvent('turn/end', { turn: 4, reason: { kind: 'completed' } })),
    ).toEqual([{ type: 'run.finished', sessionId: 's1', runId: 't4', reason: 'stop', seq: 1 }])

    // A later message outside a turn falls back to the neutral run id.
    expect(
      bridge.map(
        sessionEvent('assistant/message', {
          message: { role: 'assistant', content: [{ type: 'text', text: 'x' }] },
        }),
      ),
    ).toEqual([{ type: 'message.delta', sessionId: 's1', runId: 't0', text: 'x' }])
  })

  it('maps a runtime error onto a failed run', () => {
    const bridge = new HarnessChatBridge()

    expect(
      bridge.map({ method: 'agent.error', params: { sessionId: 's1', message: 'boom' } }),
    ).toEqual([
      { type: 'run.finished', sessionId: 's1', runId: 't0', reason: 'error', message: 'boom' },
    ])
  })

  it('ignores notifications that carry no user-visible fact', () => {
    const bridge = new HarnessChatBridge()

    expect(
      bridge.map({ method: 'session.status', params: { sessionId: 's1', status: 'idle' } }),
    ).toEqual([])
    expect(bridge.map(sessionEvent('system/message', { message: { role: 'system' } }))).toEqual([])
    expect(bridge.map({ method: 'runtime.malformed', params: { line: 'x' } })).toEqual([])
  })
})

describe('follow stream', () => {
  const follow = (frame: unknown, sessionId = 's1') => ({
    method: 'session.follow',
    params: { sessionId, frame },
  })
  const delta = (text: string) => ({
    type: 'assistant-stream',
    frame: {
      type: 'chunk',
      attemptId: 'a',
      revision: 1,
      index: 0,
      time: 0,
      chunk: { type: 'text-delta', index: 0, text },
    },
  })
  const reasoning = (text: string) => ({
    type: 'assistant-stream',
    frame: {
      type: 'chunk',
      attemptId: 'a',
      revision: 1,
      index: 1,
      time: 0,
      chunk: { type: 'reasoning-delta', index: 1, text },
    },
  })

  it('streams reasoning as its own row', () => {
    const bridge = new HarnessChatBridge()
    bridge.map(sessionEvent('turn/start', { turn: 2 }))

    expect(bridge.map(follow(reasoning('先想一下')))).toEqual([
      { type: 'thinking.delta', sessionId: 's1', runId: 't2', text: '先想一下' },
    ])
  })

  it('keeps the committed answer after reasoning-only streaming', () => {
    const bridge = new HarnessChatBridge()
    bridge.map(sessionEvent('turn/start', { turn: 2 }))
    bridge.map(follow(reasoning('先想一下')))

    const committed = bridge.map(
      sessionEvent('assistant/message', {
        turn: 2,
        step: 1,
        message: { role: 'assistant', content: [{ type: 'text', text: '答案' }] },
      }),
    )

    expect(committed).toEqual([
      { type: 'message.delta', sessionId: 's1', runId: 't2', text: '答案' },
    ])
  })

  it('streams text deltas as they arrive', () => {
    const bridge = new HarnessChatBridge()
    bridge.map(sessionEvent('turn/start', { turn: 2 }))

    expect(bridge.map(follow(delta('你')))).toEqual([
      { type: 'message.delta', sessionId: 's1', runId: 't2', text: '你' },
    ])
  })

  it('drops the committed message once the answer already streamed', () => {
    const bridge = new HarnessChatBridge()
    bridge.map(sessionEvent('turn/start', { turn: 2 }))
    bridge.map(follow(delta('你好')))

    const committed = bridge.map(
      sessionEvent('assistant/message', {
        turn: 2,
        step: 1,
        message: { role: 'assistant', content: [{ type: 'text', text: '你好' }] },
      }),
    )

    expect(committed).toEqual([])
  })

  it('still emits the committed message when nothing streamed', () => {
    const bridge = new HarnessChatBridge()
    bridge.map(sessionEvent('turn/start', { turn: 2 }))

    expect(
      bridge.map(
        sessionEvent('assistant/message', {
          turn: 2,
          step: 1,
          message: { role: 'assistant', content: [{ type: 'text', text: '完整' }] },
        }),
      ),
    ).toEqual([{ type: 'message.delta', sessionId: 's1', runId: 't2', text: '完整' }])
  })

  it('ignores the opening snapshot and attempt markers', () => {
    const bridge = new HarnessChatBridge()

    expect(
      bridge.map(follow({ type: 'snapshot', header: {}, cursor: 2, records: [], hasMore: false })),
    ).toEqual([])
    expect(
      bridge.map(follow({ type: 'assistant-stream', frame: { type: 'start', turn: 1 } })),
    ).toEqual([])
    expect(
      bridge.map(
        follow({
          type: 'assistant-stream',
          frame: { type: 'end', outcome: { kind: 'committed', seq: 9 } },
        }),
      ),
    ).toEqual([])
  })

  it('adopts the running turn the opening snapshot already contains', () => {
    const bridge = new HarnessChatBridge()

    bridge.map(
      follow({
        type: 'snapshot',
        header: {},
        cursor: 8,
        hasMore: false,
        records: [
          { type: 'event', event: { type: 'turn/start', seq: 4, time: 0, data: { turn: 2 } } },
        ],
      }),
    )

    expect(bridge.map(follow(delta('你')))).toEqual([
      { type: 'message.delta', sessionId: 's1', runId: 't2', text: '你' },
    ])
  })

  it('routes durable events from the follow stream through the same mapping', () => {
    const bridge = new HarnessChatBridge()

    expect(
      bridge.map(
        follow({
          type: 'event',
          event: { type: 'turn/start', seq: 1, time: 0, data: { turn: 4 } },
        }),
      ),
    ).toEqual([{ type: 'run.started', sessionId: 's1', runId: 't4', seq: 1 }])
  })
  describe('tools', () => {
    const call = (name: string, callId: string, args: unknown) =>
      sessionEvent('tool/call', { turn: 1, step: 1, callId, name, arguments: JSON.stringify(args) })
    const result = (callId: string, content: unknown[], extra: Record<string, unknown> = {}) =>
      sessionEvent('tool/result', {
        turn: 1,
        step: 1,
        message: { role: 'tool', toolCallId: callId, content },
        ...extra,
      })

    it('reports a call with its arguments parsed', () => {
      const bridge = new HarnessChatBridge()
      bridge.map(sessionEvent('turn/start', { turn: 1 }))

      expect(bridge.map(call('read', 'c1', { file_path: 'a.md' }))).toEqual([
        {
          type: 'tool.started',
          sessionId: 's1',
          runId: 't1',
          tool: 'read',
          input: { file_path: 'a.md' },
        },
      ])
    })

    it('names a result after the call it belongs to', () => {
      const bridge = new HarnessChatBridge()
      bridge.map(sessionEvent('turn/start', { turn: 1 }))
      bridge.map(call('read', 'c1', { file_path: 'a.md' }))

      expect(bridge.map(result('c1', [{ type: 'text', text: 'file body' }]))).toEqual([
        {
          type: 'tool.finished',
          sessionId: 's1',
          runId: 't1',
          tool: 'read',
          output: 'file body',
          isError: false,
        },
      ])
    })

    it('marks a result as failed when the call reported an error', () => {
      const bridge = new HarnessChatBridge()
      bridge.map(sessionEvent('turn/start', { turn: 1 }))
      bridge.map(call('bash', 'c2', { command: 'ls' }))

      const [event] = bridge.map(
        result('c2', [{ type: 'text', text: 'denied' }], { error: { name: 'E', code: 'denied' } }),
      )

      expect(event).toMatchObject({ tool: 'bash', output: 'denied', isError: true })
    })
  })

  it('treats an interrupted turn as cancelled', () => {
    const bridge = new HarnessChatBridge()
    bridge.map(sessionEvent('turn/start', { turn: 1 }))

    expect(
      bridge.map(sessionEvent('turn/end', { turn: 1, reason: { kind: 'interrupted' } })),
    ).toEqual([{ type: 'run.finished', sessionId: 's1', runId: 't1', reason: 'cancelled', seq: 1 }])
  })

  it('carries the failure message a failed turn reports', () => {
    const bridge = new HarnessChatBridge()
    bridge.map(sessionEvent('turn/start', { turn: 1 }))

    expect(
      bridge.map(
        sessionEvent('turn/end', {
          turn: 1,
          reason: {
            kind: 'error',
            error: {
              message: 'DeepSeek Messages SSE event type mismatch',
              code: 'MALFORMED_RESPONSE',
            },
          },
        }),
      ),
    ).toEqual([
      {
        type: 'run.finished',
        sessionId: 's1',
        runId: 't1',
        reason: 'error',
        message: 'DeepSeek Messages SSE event type mismatch',
        seq: 1,
      },
    ])
  })
})
