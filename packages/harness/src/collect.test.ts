import { describe, expect, it, vi } from 'vitest'

import type { WebSocketConstructor, WebSocketLike } from './follow.js'
import { streamCollect } from './collect.js'

/** Records what was sent and lets a test drive the socket events. */
class FakeSocket implements WebSocketLike {
  readonly sent: string[] = []
  closed = false
  readonly #listeners = new Map<string, ((...args: unknown[]) => void)[]>()

  on(event: string, listener: (...args: unknown[]) => void): void {
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

  frame(value: unknown): void {
    this.emit('message', JSON.stringify(value))
  }
}

function make(socket: FakeSocket, budgetMs = 50) {
  const WebSocket = (() => socket) as unknown as WebSocketConstructor
  return streamCollect({
    url: 'ws://127.0.0.1:1/api/remote.mux',
    cookie: 'c=1',
    endpoint: 'job/follow',
    request: { jobId: 'j1' },
    WebSocket,
    budgetMs,
  })
}

describe('streamCollect', () => {
  it('keeps every item until the stream ends', async () => {
    const socket = new FakeSocket()
    const pending = make(socket)
    socket.emit('open')
    expect(JSON.parse(socket.sent[0] ?? '{}')).toMatchObject({
      type: 'open',
      endpoint: 'job/follow',
      payload: { args: { request: { jobId: 'j1' } } },
    })

    socket.frame({ type: 'item', value: { type: 'opened' } })
    socket.frame({ type: 'item', value: { type: 'output', chunks: [] } })
    socket.frame({ type: 'end' })

    await expect(pending).resolves.toEqual({
      items: [{ type: 'opened' }, { type: 'output', chunks: [] }],
      ended: true,
    })
    expect(socket.closed).toBe(true)
  })

  it('resolves with what arrived when the budget runs out on a live stream', async () => {
    // A running job's stream never ends; waiting for it would hang the window.
    vi.useFakeTimers()
    const socket = new FakeSocket()
    const pending = make(socket)
    socket.emit('open')
    socket.frame({ type: 'item', value: { type: 'output', chunks: [{ text: 'a' }] } })

    vi.advanceTimersByTime(60)
    await expect(pending).resolves.toEqual({
      items: [{ type: 'output', chunks: [{ text: 'a' }] }],
      ended: false,
    })
    vi.useRealTimers()
  })

  it('rejects when the runtime refuses the read', async () => {
    const socket = new FakeSocket()
    const pending = make(socket)
    socket.emit('open')
    socket.frame({ type: 'error', error: { code: 'job/not-found', message: '没有这个任务' } })

    await expect(pending).rejects.toThrow(/job\/follow 失败：job\/not-found: 没有这个任务/)
  })

  it('treats a close after items as the end of the stream', async () => {
    const socket = new FakeSocket()
    const pending = make(socket)
    socket.emit('open')
    socket.frame({ type: 'item', value: { type: 'output', chunks: [] } })

    socket.emit('close')
    await expect(pending).resolves.toMatchObject({ ended: true })
  })

  it('rejects a stream that closes before saying anything', async () => {
    const socket = new FakeSocket()
    const pending = make(socket)
    socket.emit('open')
    socket.emit('close')

    await expect(pending).rejects.toThrow(/回答前关闭/)
  })
})
