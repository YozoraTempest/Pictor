import { describe, expect, it, vi } from 'vitest'

import { ChatService } from './chat-service.js'
import type { BridgeEvent, OpenedAgent } from './sdk-bridge.js'
import type { ChatEvent } from './types.js'

function fakeAgent(
  path: string,
  emit: (event: BridgeEvent) => void,
): OpenedAgent & { interceptor: unknown } {
  return {
    path,
    interceptor: null,
    async prompt(text: string): Promise<void> {
      emit({ type: 'delta', text: `echo: ${text}` })
    },
    async abort(): Promise<void> {},
    dispose: vi.fn(),
    setToolInterceptor(interceptor): void {
      this.interceptor = interceptor
    },
  }
}

describe('ChatService', () => {
  it('opens a session and streams normalized events', async () => {
    const events: ChatEvent[] = []
    let emit: (event: BridgeEvent) => void = () => undefined

    const service = new ChatService({
      onEvent: (event) => events.push(event),
      openAgent: async (_input, onEvent) => {
        emit = onEvent
        return fakeAgent('/tmp/pi/session.jsonl', onEvent)
      },
    })

    const opened = await service.open({
      sessionId: 's1',
      cwd: '/tmp',
      sessionDir: '/tmp/pi',
      agentDir: '/tmp/agent',
      modelsPath: '/tmp/models.json',
      modelId: 'demo',
      apiKey: null,
      sessionPath: null,
    })

    expect(opened.path).toBe('/tmp/pi/session.jsonl')

    await service.send('hello')

    expect(events.map((event) => event.type)).toEqual([
      'run.started',
      'message.delta',
      'run.finished',
    ])
    expect(events[1]).toMatchObject({ text: 'echo: hello' })
    expect(events.every((event) => event.sessionId === 's1')).toBe(true)
    expect(emit).toBeTypeOf('function')
  })

  it('reports errors from the agent as a finished event', async () => {
    const events: ChatEvent[] = []
    const service = new ChatService({
      onEvent: (event) => events.push(event),
      openAgent: async (_input, _onEvent) => ({
        path: '/tmp/x.jsonl',
        async prompt(): Promise<void> {
          throw new Error('endpoint failed')
        },
        async abort(): Promise<void> {},
        dispose(): void {},
        setToolInterceptor(): void {},
      }),
    })

    await service.open({
      sessionId: 's1',
      cwd: '/tmp',
      sessionDir: '/tmp/pi',
      agentDir: '/tmp/agent',
      modelsPath: '/tmp/models.json',
      modelId: 'demo',
      apiKey: null,
      sessionPath: null,
    })

    await service.send('hello')

    expect(events.at(-1)).toMatchObject({ type: 'run.finished', reason: 'error' })
  })

  it('forwards the tool interceptor to the open agent', async () => {
    const agent = fakeAgent('/tmp/x.jsonl', () => undefined)
    const service = new ChatService({
      onEvent: () => undefined,
      openAgent: async () => agent,
    })

    service.setToolInterceptor(async () => ({ block: true }))
    await service.open({
      sessionId: 's1',
      cwd: '/tmp',
      sessionDir: '/tmp/pi',
      agentDir: '/tmp/agent',
      modelsPath: '/tmp/models.json',
      modelId: 'demo',
      apiKey: null,
      sessionPath: null,
    })

    expect(agent.interceptor).toBeTypeOf('function')
  })

  it('reports a blocked tool call so the transcript can show it', async () => {
    const events: ChatEvent[] = []
    const agent = fakeAgent('/tmp/x.jsonl', () => undefined)
    const service = new ChatService({
      onEvent: (event) => events.push(event),
      openAgent: async () => agent,
    })

    service.setToolInterceptor(async () => ({ block: true, reason: 'rm is not allowed' }))
    await service.open({
      sessionId: 's1',
      cwd: '/tmp',
      sessionDir: '/tmp/pi',
      agentDir: '/tmp/agent',
      modelsPath: '/tmp/models.json',
      modelId: 'demo',
      apiKey: null,
      sessionPath: null,
    })

    const interceptor = agent.interceptor as (input: {
      tool: string
      args: unknown
    }) => Promise<{ block?: boolean; reason?: string } | undefined>

    const decision = await interceptor({ tool: 'bash', args: { cmd: 'rm -rf /' } })

    expect(decision).toMatchObject({ block: true })
    expect(events).toContainEqual({
      type: 'tool.blocked',
      sessionId: 's1',
      runId: expect.any(String),
      tool: 'bash',
      reason: 'rm is not allowed',
    })
  })

  it('stays quiet when the guard allows the call', async () => {
    const events: ChatEvent[] = []
    const agent = fakeAgent('/tmp/x.jsonl', () => undefined)
    const service = new ChatService({
      onEvent: (event) => events.push(event),
      openAgent: async () => agent,
    })

    service.setToolInterceptor(async () => ({ block: false }))
    await service.open({
      sessionId: 's1',
      cwd: '/tmp',
      sessionDir: '/tmp/pi',
      agentDir: '/tmp/agent',
      modelsPath: '/tmp/models.json',
      modelId: 'demo',
      apiKey: null,
      sessionPath: null,
    })

    const interceptor = agent.interceptor as (input: {
      tool: string
      args: unknown
    }) => Promise<{ block?: boolean } | undefined>
    await interceptor({ tool: 'bash', args: {} })

    expect(events.some((event) => event.type === 'tool.blocked')).toBe(false)
  })

  it('rejects send when no session is open', async () => {
    const service = new ChatService({ onEvent: () => undefined })
    await expect(service.send('hello')).rejects.toThrow(/no chat session/)
  })

  it('refuses to take over a session another instance owns', async () => {
    const first = fakeAgent('/tmp/a.jsonl', () => undefined)
    const second = fakeAgent('/tmp/b.jsonl', () => undefined)
    const agents = [first, second]

    const service = new ChatService({
      onEvent: () => undefined,
      openAgent: async () => agents.shift() as OpenedAgent,
    })

    const input = {
      sessionId: 's1',
      cwd: '/tmp',
      sessionDir: '/tmp/pi',
      agentDir: '/tmp/agent',
      modelsPath: '/tmp/models.json',
      modelId: 'demo',
      apiKey: null,
      sessionPath: null,
    }

    await service.open(input)

    // One runtime owns one conversation: a second session must go to its own
    // service, otherwise the two runs would fight over the same agent.
    await expect(service.open({ ...input, sessionId: 's2' })).rejects.toThrow(/already owns/)
    expect(first.dispose).not.toHaveBeenCalled()
    expect(service.activeSessionId).toBe('s1')
  })
})
