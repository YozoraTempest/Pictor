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

    expect(bridge.map(sessionEvent('turn/start', { turn: 3 }))).toEqual([
      { type: 'run.started', sessionId: 's1', runId: 't3' },
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
      bridge.map(sessionEvent('tool/call', { name: 'read', arguments: { path: 'a.ts' } })),
    ).toEqual([
      { type: 'tool.started', sessionId: 's1', runId: 't2', tool: 'read', input: { path: 'a.ts' } },
    ])

    expect(
      bridge.map(
        sessionEvent('tool/result', { name: 'read', output: 'file body', isError: false }),
      ),
    ).toMatchObject([{ type: 'tool.finished', tool: 'read', isError: false, output: 'file body' }])
  })

  it('closes the run on turn/end and forgets its id', () => {
    const bridge = new HarnessChatBridge()
    bridge.map(sessionEvent('turn/start', { turn: 4 }))

    expect(
      bridge.map(sessionEvent('turn/end', { turn: 4, reason: { kind: 'completed' } })),
    ).toEqual([{ type: 'run.finished', sessionId: 's1', runId: 't4', reason: 'stop' }])

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
