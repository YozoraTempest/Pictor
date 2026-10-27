import { DSH } from './wire.js'
import { describe, expect, it, vi } from 'vitest'

import type { WebSocketConstructor, WebSocketLike } from './follow.js'
import { streamOnce } from './once.js'

/** Records what was sent and lets a test drive the socket events. */
class FakeSocket implements WebSocketLike {
  readonly sent: string[] = []
  closed = false
  readonly #listeners = new Map<string, ((...args: unknown[]) => void)[]>()
  /** Set to throw from `close()`, standing in for a socket that already died. */
  throwOnClose = false

  on(event: string, listener: (...args: unknown[]) => void): void {
    const list = this.#listeners.get(event) ?? []
    list.push(listener)
    this.#listeners.set(event, list)
  }

  send(data: string): void {
    this.sent.push(data)
  }

  close(): void {
    if (this.throwOnClose) throw new Error('socket already gone')
    this.closed = true
    this.emit('close')
  }

  emit(event: string, ...args: unknown[]): void {
    for (const listener of this.#listeners.get(event) ?? []) listener(...args)
  }

  frame(value: unknown): void {
    this.emit('message', JSON.stringify(value))
  }
}

function make(socket: FakeSocket) {
  const WebSocket = (() => socket) as unknown as WebSocketConstructor
  return streamOnce({
    url: 'ws://127.0.0.1:1/api/remote.mux',
    cookie: 'c=1',
    endpoint: DSH.job.list,
    request: { sessionId: 's1' },
    WebSocket,
    timeoutMs: 50,
  })
}

describe('streamOnce', () => {
  it('opens the endpoint and resolves the opening frame', async () => {
    const socket = new FakeSocket()
    const pending = make(socket)

    socket.emit('open')
    expect(JSON.parse(socket.sent[0] ?? '{}')).toEqual({
      type: 'open',
      streamId: expect.any(String) as unknown as string,
      endpoint: DSH.job.list,
      payload: { args: { request: { sessionId: 's1' } } },
    })

    socket.frame({ type: 'item', value: { type: 'rows', jobs: [] } })
    await expect(pending).resolves.toEqual({ type: 'rows', jobs: [] })
    // One value is the whole point: the stream is closed, not left running.
    expect(socket.closed).toBe(true)
  })

  it('rejects with the runtime’s own code when the stream fails', async () => {
    const socket = new FakeSocket()
    const pending = make(socket)
    socket.emit('open')

    socket.frame({ type: 'error', error: { code: 'session/not-found', message: '没有这个会话' } })
    await expect(pending).rejects.toThrow(/job\/list 失败：session\/not-found: 没有这个会话/)
  })

  it('treats an end before any frame as an empty answer', async () => {
    const socket = new FakeSocket()
    const pending = make(socket)
    socket.emit('open')

    socket.frame({ type: 'end' })
    await expect(pending).resolves.toBeNull()
  })

  it('rejects when the socket closes before answering', async () => {
    // A reconnect that never answers is a failed read, not an empty roster.
    const socket = new FakeSocket()
    const pending = make(socket)
    socket.emit('open')

    socket.emit('close')
    await expect(pending).rejects.toThrow(/回答前关闭/)
  })

  it('gives up rather than waiting on a stuck runtime', async () => {
    vi.useFakeTimers()
    const socket = new FakeSocket()
    const pending = make(socket)
    socket.emit('open')

    vi.advanceTimersByTime(60)
    await expect(pending).rejects.toThrow(/50ms 内没有回答/)
    vi.useRealTimers()
  })
})
