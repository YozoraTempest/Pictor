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
    retry: null,
    usage: null,
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

  it('completes a streamed tool row in place when the call lands', () => {
    const { handleEvent } = useChatStore.getState()

    handleEvent({ type: 'run.started', sessionId: 's1', runId: 'run-1' })
    handleEvent({
      type: 'tool.pending',
      sessionId: 's1',
      runId: 'run-1',
      callId: 'c1',
      tool: 'read',
      argumentsText: '{"path": "a.md"}',
    })
    handleEvent({
      type: 'tool.started',
      sessionId: 's1',
      runId: 'run-1',
      tool: 'read',
      input: { path: 'a.md' },
      callId: 'c1',
    })
    handleEvent({
      type: 'tool.finished',
      sessionId: 's1',
      runId: 'run-1',
      tool: 'read',
      output: 'file body',
      isError: false,
      callId: 'c1',
    })

    const messages = useChatStore.getState().current.messages
    // One call, one row: the streamed stub must not survive beside the real call.
    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({
      role: 'tool',
      toolName: 'read',
      input: { path: 'a.md' },
      text: 'file body',
      pending: false,
    })
  })

  it('keeps two calls of the same tool apart while they stream', () => {
    const { handleEvent } = useChatStore.getState()
    handleEvent({ type: 'run.started', sessionId: 's1', runId: 'run-1' })
    for (const callId of ['a', 'b']) {
      handleEvent({
        type: 'tool.pending',
        sessionId: 's1',
        runId: 'run-1',
        callId,
        tool: 'read',
        argumentsText: `{"path": "${callId}.md"}`,
      })
    }

    const rows = useChatStore.getState().current.messages
    expect(rows.map((row) => row.toolCallId)).toEqual(['a', 'b'])
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

  it('appends the row a compaction deserves, at the point it happened', () => {
    const { handleEvent } = useChatStore.getState()

    handleEvent({ type: 'run.started', sessionId: 's1', runId: 'run-1' })
    handleEvent({ type: 'message.delta', sessionId: 's1', runId: 'run-1', text: '答完这句' })
    handleEvent({
      type: 'run.compacted',
      sessionId: 's1',
      runId: 'run-1',
      savedTokens: 4200,
      summary: '前几轮的结论',
      reason: 'threshold',
    })

    const messages = useChatStore.getState().current.messages
    // The answer stays the answer: a divider is not allowed to swallow or split it.
    expect(messages.map((message) => message.role)).toEqual(['assistant', 'notice'])
    expect(messages[1]?.notice).toEqual({
      kind: 'compaction',
      savedTokens: 4200,
      summary: '前几轮的结论',
    })
  })

  it('draws the divider with no count when the runtime did not report one', () => {
    const { handleEvent } = useChatStore.getState()

    handleEvent({
      type: 'run.compacted',
      sessionId: 's1',
      runId: 'run-1',
      savedTokens: null,
      summary: null,
      reason: null,
    })

    expect(useChatStore.getState().current.messages[0]?.notice).toEqual({
      kind: 'compaction',
      savedTokens: null,
      summary: '',
    })
  })

  it('ignores events that belong to another session', () => {
    const { handleEvent } = useChatStore.getState()

    handleEvent({ type: 'message.delta', sessionId: 'other', runId: 'run-1', text: '不该出现' })

    expect(useChatStore.getState().current.messages).toEqual([])
  })
})

describe('chat-store open', () => {
  beforeEach(() => {
    useChatStore.setState({
      viewing: null,
      chats: {},
      current: { ...useChatStore.getState().current, sessionId: '' },
    })
  })

  it('skips the call when the transcript is already loaded, and reloads on request', async () => {
    let calls = 0
    ;(window as unknown as { pictor: unknown }).pictor = {
      openChat: async () => {
        calls += 1
        return { path: 'harness:s1', history: { messages: [], nextOffset: 0, hasMore: false } }
      },
    }

    await useChatStore.getState().open('s1')
    await useChatStore.getState().open('s1')
    // Cached: the second open must not reset a transcript the user is reading.
    expect(calls).toBe(1)

    await useChatStore.getState().open('s1', { reload: true })
    expect(calls).toBe(2)
  })
})

describe('chat-store send', () => {
  it('carries images beside the text and keeps them on the optimistic row', async () => {
    const calls: unknown[][] = []
    ;(window as unknown as { pictor: unknown }).pictor = {
      sendChat: async (...args: unknown[]) => {
        calls.push(args)
      },
    }

    const slice = {
      sessionId: 's1',
      path: 'harness:s1',
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
      retry: null,
      usage: null,
    }
    useChatStore.setState({ viewing: 's1', chats: { s1: slice }, current: slice })

    const image = { mediaType: 'image/png', data: 'AAAA', name: 'shot.png' }
    await useChatStore.getState().send('看看这张图', [image])

    expect(calls[0]).toEqual(['s1', '看看这张图', [image], null])
    expect(useChatStore.getState().current.messages[0]?.images).toEqual([image])
  })

  it('sends an image-only message', async () => {
    const calls: unknown[][] = []
    ;(window as unknown as { pictor: unknown }).pictor = {
      sendChat: async (...args: unknown[]) => {
        calls.push(args)
      },
    }

    const slice = {
      sessionId: 's1',
      path: 'harness:s1',
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
      retry: null,
      usage: null,
    }
    useChatStore.setState({ viewing: 's1', chats: { s1: slice }, current: slice })

    await useChatStore.getState().send('  ', [{ mediaType: 'image/jpeg', data: 'BBBB' }])
    expect(calls).toHaveLength(1)
  })
})
