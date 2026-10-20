// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'

import { useChatStore } from './chat-store.js'

function reset(): void {
  useChatStore.setState({
    sessionId: 's1',
    path: '/tmp/session.jsonl',
    messages: [],
    offset: 0,
    hasMore: false,
    loading: false,
    running: false,
    error: null,
    requestId: 0,
  })
}

describe('chat-store handleEvent', () => {
  beforeEach(reset)

  it('keeps one assistant row while the reply streams', () => {
    const { handleEvent } = useChatStore.getState()

    handleEvent({ type: 'run.started', sessionId: 's1', runId: 'run-1' })
    handleEvent({ type: 'message.delta', sessionId: 's1', runId: 'run-1', text: '你' })
    handleEvent({ type: 'message.delta', sessionId: 's1', runId: 'run-1', text: '好' })

    const messages = useChatStore.getState().messages
    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({ role: 'assistant', text: '你好' })
  })

  it('gives the segment after a tool call its own id', () => {
    const { handleEvent } = useChatStore.getState()

    handleEvent({ type: 'run.started', sessionId: 's1', runId: 'run-1' })
    handleEvent({ type: 'message.delta', sessionId: 's1', runId: 'run-1', text: '先看看' })
    handleEvent({ type: 'tool.started', sessionId: 's1', runId: 'run-1', tool: 'ls', input: {} })
    handleEvent({
      type: 'tool.finished',
      sessionId: 's1',
      runId: 'run-1',
      tool: 'ls',
      output: 'a',
      isError: false,
    })
    handleEvent({ type: 'message.delta', sessionId: 's1', runId: 'run-1', text: '目录里' })
    handleEvent({ type: 'message.delta', sessionId: 's1', runId: 'run-1', text: '有 a' })

    const messages = useChatStore.getState().messages
    const ids = messages.map((message) => message.id)

    // Duplicate keys made React stop updating the transcript until it remounted.
    expect(new Set(ids).size).toBe(ids.length)
    expect(
      messages.filter((message) => message.role === 'assistant').map((message) => message.text),
    ).toEqual(['先看看', '目录里有 a'])
  })

  it('closes a tool row that never reported a result when the run ends', () => {
    const { handleEvent } = useChatStore.getState()

    handleEvent({ type: 'run.started', sessionId: 's1', runId: 'run-1' })
    handleEvent({ type: 'tool.started', sessionId: 's1', runId: 'run-1', tool: 'bash', input: {} })
    handleEvent({ type: 'run.finished', sessionId: 's1', runId: 'run-1', reason: 'stop' })

    const [row] = useChatStore.getState().messages
    expect(row).toMatchObject({ role: 'tool', toolName: 'bash', isError: true })
    expect(row?.text).toBe('运行结束时没有拿到结果')
    expect(useChatStore.getState().running).toBe(false)
  })

  it('ignores events that belong to another session', () => {
    const { handleEvent } = useChatStore.getState()

    handleEvent({ type: 'message.delta', sessionId: 'other', runId: 'run-1', text: '不该出现' })

    expect(useChatStore.getState().messages).toEqual([])
  })
})
