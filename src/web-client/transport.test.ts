import { afterEach, describe, expect, it, vi } from 'vitest'

import { commandEventSchema } from '../commands/contract.js'
import type { WebClientMessage, WebServerMessage } from '../shared/web-protocol.js'
import { createWebTransports, type WebEventTransport } from './transport.js'

const EXECUTION_ID = '11111111-1111-4111-8111-111111111111'
const CORRELATION_ID = '22222222-2222-4222-8222-222222222222'
const AT = '2026-09-18T00:00:00.000Z'

class FakeEventTransport implements WebEventTransport {
  readonly sent: WebClientMessage[] = []
  private readonly listeners = new Set<(message: WebServerMessage) => void>()

  send(message: WebClientMessage): void {
    this.sent.push(message)
  }

  onMessage(listener: (message: WebServerMessage) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  emit(message: WebServerMessage): void {
    for (const listener of [...this.listeners]) listener(message)
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('createWebTransports', () => {
  it('保留先于 execute 响应到达的事件，并在重连后请求回放', async () => {
    const connection = new FakeEventTransport()
    let resolveExecute: ((response: Response) => void) | undefined
    const executeResponse = new Promise<Response>((resolve) => {
      resolveExecute = resolve
    })
    const fetch = vi.fn<typeof globalThis.fetch>().mockReturnValue(executeResponse)
    vi.stubGlobal('fetch', fetch)
    const transports = createWebTransports(connection)

    const executePromise = transports.commands.execute(
      'test.command',
      { value: 1 },
      { frontend: 'gui', correlationId: CORRELATION_ID },
    )
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce())

    const started = commandEventSchema.parse({
      type: 'started',
      sequence: 0,
      executionId: EXECUTION_ID,
      commandId: 'test.command',
      context: { frontend: 'gui', correlationId: CORRELATION_ID },
      at: AT,
    })
    const completed = commandEventSchema.parse({
      type: 'completed',
      sequence: 1,
      executionId: EXECUTION_ID,
      commandId: 'test.command',
      result: { executionId: EXECUTION_ID, commandId: 'test.command', value: { ok: true } },
      at: AT,
    })
    connection.emit({ type: 'command.event', event: started })
    connection.emit({ type: 'command.event', event: completed })
    resolveExecute?.(
      Response.json({
        ok: true,
        value: { executionId: EXECUTION_ID, commandId: 'test.command' },
      }),
    )

    await expect(executePromise).resolves.toEqual({
      executionId: EXECUTION_ID,
      commandId: 'test.command',
    })
    const replayed: string[] = []
    transports.commands.subscribe(EXECUTION_ID, (event) => replayed.push(event.type))
    expect(replayed).toEqual(['started', 'completed'])

    connection.emit({
      type: 'connection.ready',
      generation: '33333333-3333-4333-8333-333333333333',
    })
    expect(connection.sent).toEqual([{ type: 'command.replay', executionId: EXECUTION_ID }])
  })

  it('按 Module 和事件名分发 WebSocket 事件', () => {
    const connection = new FakeEventTransport()
    vi.stubGlobal('fetch', vi.fn<typeof globalThis.fetch>())
    const transports = createWebTransports(connection)
    const received: unknown[] = []
    const release = transports.modules.onEvent('test.module', 'changed', (payload) => {
      received.push(payload)
    })

    connection.emit({
      type: 'module.event',
      event: { moduleId: 'other.module', event: 'changed', payload: 1 },
    })
    connection.emit({
      type: 'module.event',
      event: { moduleId: 'test.module', event: 'changed', payload: { value: 2 } },
    })
    release()
    connection.emit({
      type: 'module.event',
      event: { moduleId: 'test.module', event: 'changed', payload: 3 },
    })

    expect(received).toEqual([{ value: 2 }])
  })

  it('在 Module 调用完成后通知文件传输观察器且不改变返回值', async () => {
    const connection = new FakeEventTransport()
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValue(Response.json({ ok: true, value: { ok: true, value: true } })),
    )
    const settled = vi.fn(() => {
      throw new Error('browser download failed')
    })
    const transports = createWebTransports(connection, { onModuleInvocationSettled: settled })

    await expect(
      transports.modules.invoke('pictor.agent-workspace', 'exportSession', {
        destinationPath: '/tmp/session.html',
      }),
    ).resolves.toEqual({ ok: true, value: true })
    expect(settled).toHaveBeenCalledWith(
      'pictor.agent-workspace',
      'exportSession',
      { destinationPath: '/tmp/session.html' },
      { status: 'fulfilled', value: { ok: true, value: true } },
    )
  })
})
