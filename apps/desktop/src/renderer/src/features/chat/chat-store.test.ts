// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'

import { useChatStore } from './chat-store.js'
function reset(): void {
  const slice = {
    sessionId: 's1',
    path: '/tmp/session.jsonl',
    messages: [],
    offset: 0,
    hasMore: false,
    loading: false,
    running: false,
    runStartedAt: null,
    runFinishedAt: null,
    phase: 'idle' as const,
    currentTool: null,
    error: null,
  }

  useChatStore.setState({ viewing: 's1', chats: { s1: slice }, current: slice })
}

describe('chat-store handleEvent', () => {
  beforeEach(reset)

  it('keeps one assistant row while the reply streams', () => {
    const { handleEvent } = useChatStore.getState()

    handleEvent({ type: 'run.started', sessionId: 's1', runId: 'run-1' })
    handleEvent({ type: 'message.delta', sessionId: 's1', runId: 'run-1', text: '你' })
    handleEvent({ type: 'message.delta', sessionId: 's1', runId: 'run-1', text: '好' })

    const messages = useChatStore.getState().current.messages
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

    const messages = useChatStore.getState().current.messages
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

    const [row] = useChatStore.getState().current.messages
    expect(row).toMatchObject({ role: 'tool', toolName: 'bash', isError: true })
    expect(row?.text).toBe('运行结束时没有拿到结果')
    expect(useChatStore.getState().current.running).toBe(false)
  })

  it('ignores events that belong to another session', () => {
    const { handleEvent } = useChatStore.getState()

    handleEvent({ type: 'message.delta', sessionId: 'other', runId: 'run-1', text: '不该出现' })

    expect(useChatStore.getState().current.messages).toEqual([])
  })
})
