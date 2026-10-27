import { describe, expect, it } from 'vitest'

import { EventStream, type RemoteWaterfallFrame } from './events.js'
import type { WebSocketConstructor, WebSocketLike } from './follow.js'

/** Records what the client sent and lets the test play the server's part. */
class FakeSocket implements WebSocketLike {
  readonly sent: string[] = []
  closed = false
  readonly #listeners = new Map<string, ((...args: unknown[]) => void)[]>()

  on(event: 'open' | 'message' | 'error' | 'close', listener: (...args: unknown[]) => void): void {
    const list = this.#listeners.get(event) ?? []
    list.push(listener)
    this.#listeners.set(event, list)
  }

  send(data: string): void {
    this.sent.push(data)
  }

  close(): void {
    this.closed = true
    this.emit('close')
  }

  emit(event: string, ...args: unknown[]): void {
    for (const listener of this.#listeners.get(event) ?? []) listener(...args)
  }

  /** Plays one item frame from the gateway. */
  item(value: unknown, streamId = '$events'): void {
    this.emit('message', JSON.stringify({ type: 'item', streamId, value }))
  }
}

function stream(onWaterfall: (frame: RemoteWaterfallFrame) => void, socket = new FakeSocket()) {
  const created: FakeSocket[] = []
  const WebSocket: WebSocketConstructor = () => {
    created.push(socket)
    return socket
  }
  const client = new EventStream({
    url: 'ws://127.0.0.1:1/api/remote.mux',
    cookie: 'c=1',
    onWaterfall,
    WebSocket,
  })
  return { client, socket, created }
}

describe('EventStream', () => {
  it('subscribes to the gateway event stream with empty arguments', async () => {
    const { client, socket } = stream(() => undefined)
    const opening = client.open()
    socket.emit('open')
    socket.item({ type: 'ready', clientId: 'client-1' })
    await opening

    expect(JSON.parse(socket.sent[0] ?? '{}')).toEqual({
      type: 'open',
      streamId: '$events',
      endpoint: '$events',
      payload: { args: {} },
    })
    expect(client.clientId).toBe('client-1')
  })

  it('forwards a waterfall question and keeps its handle', async () => {
    const seen: RemoteWaterfallFrame[] = []
    const { client, socket } = stream((frame) => seen.push(frame))
    const opening = client.open()
    socket.emit('open')
    socket.item({
      type: 'waterfall',
      event: 'approval/request',
      eventId: 'ev-1',
      agentId: 'agent-1',
      request: { toolName: 'bash', reason: '写文件' },
    })
    await opening

    expect(seen).toEqual([
      {
        type: 'waterfall',
        event: 'approval/request',
        eventId: 'ev-1',
        agentId: 'agent-1',
        request: { toolName: 'bash', reason: '写文件' },
      },
    ])
  })

  it('ignores items that belong to another stream', async () => {
    const seen: RemoteWaterfallFrame[] = []
    const { client, socket } = stream((frame) => seen.push(frame))
    const opening = client.open()
    socket.emit('open')
    socket.item({ type: 'waterfall', event: 'approval/request', eventId: 'ev-1' }, 'follow')
    await opening

    expect(seen).toEqual([])
  })

  it('closes on a stream error instead of leaving a dead client', async () => {
    const errors: Error[] = []
    const socket = new FakeSocket()
    const WebSocket: WebSocketConstructor = () => socket
    const client = new EventStream({
      url: 'ws://127.0.0.1:1/api/remote.mux',
      cookie: 'c=1',
      onWaterfall: () => undefined,
      onError: (error) => errors.push(error),
      WebSocket,
    })
    const opening = client.open()
    socket.emit('open')
    socket.emit(
      'message',
      JSON.stringify({ type: 'error', streamId: '$events', error: { code: 'x', message: 'boom' } }),
    )
    await opening

    expect(errors[0]?.message).toContain('boom')
    expect(client.active).toBe(false)
    expect(socket.closed).toBe(true)
  })
})
