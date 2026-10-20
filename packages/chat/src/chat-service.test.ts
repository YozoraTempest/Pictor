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

  it('rejects send when no session is open', async () => {
    const service = new ChatService({ onEvent: () => undefined })
    await expect(service.send('hello')).rejects.toThrow(/no chat session/)
  })

  it('disposes the previous agent when switching sessions', async () => {
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
    await service.open({ ...input, sessionId: 's2' })

    expect(first.dispose).toHaveBeenCalled()
  })
})
