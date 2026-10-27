import { DSH } from './wire.js'
import { describe, expect, it, vi } from 'vitest'

import { FollowStream, type WebSocketConstructor, type WebSocketLike } from './follow.js'
import type { SessionFollowFrame } from './session.js'

/** Records what the stream sends and lets a test drive the socket events. */
class FakeSocket implements WebSocketLike {
  readonly sent: string[] = []
  closed = false
  header: Record<string, string> | null = null
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

function make(): {
  socket: FakeSocket
  frames: SessionFollowFrame[]
  errors: Error[]
  stream: FollowStream
} {
  const socket = new FakeSocket()
  const frames: SessionFollowFrame[] = []
  const errors: Error[] = []
  const WebSocket = ((_url: string, options: { headers: Record<string, string> }) => {
    socket.header = options.headers
    return socket
  }) as WebSocketConstructor
  const stream = new FollowStream({
    url: 'ws://127.0.0.1:4242/api/remote.mux',
    cookie: 'dsh-auth-abc',
    WebSocket,
    onFrame: (frame) => frames.push(frame),
    onError: (error) => errors.push(error),
  })
  return { socket, frames, errors, stream }
}

describe('FollowStream', () => {
  it('authenticates with the cookie and opens session/follow with the request', () => {
    const fake = make()
    fake.stream.open({ address: { kind: 'session', sessionId: 's1' }, assistantStream: true })

    expect(fake.socket.header).toEqual({ cookie: 'dsh-auth-abc' })
    // The open frame only goes out once the socket is up.
    expect(fake.socket.sent).toHaveLength(0)
    fake.socket.emit('open')
    expect(fake.socket.sent).toHaveLength(1)

    const sent = JSON.parse(fake.socket.sent[0] ?? '{}') as {
      type: string
      streamId: string
      endpoint: string
      payload: unknown
    }
    expect(sent.type).toBe('open')
    expect(sent.endpoint).toBe(DSH.session.follow)
    expect(sent.payload).toEqual({
      args: {
        request: { address: { kind: 'session', sessionId: 's1' }, assistantStream: true },
      },
    })
  })

  it('forwards item frames of its own stream only', () => {
    const fake = make()
    fake.stream.open({ address: { kind: 'session', sessionId: 's1' } })
    fake.socket.emit('open')

    fake.socket.frame({
      type: 'item',
      streamId: 'follow',
      value: { type: 'assistant-stream', frame: { type: 'start', turn: 1 } },
    })
    fake.socket.frame({ type: 'item', streamId: 'other', value: { type: 'event' } })
    fake.socket.frame({ type: 'item', streamId: 'follow' })

    expect(fake.frames).toHaveLength(1)
    expect(fake.frames[0]?.type).toBe('assistant-stream')
  })

  it('reports a stream failure once and stops', () => {
    const fake = make()
    fake.stream.open({ address: { kind: 'session', sessionId: 's1' } })
    fake.socket.emit('open')

    fake.socket.frame({
      type: 'error',
      streamId: 'follow',
      error: { code: 'gateway/arguments-invalid', message: 'requires an empty args object' },
    })
    fake.socket.frame({ type: 'error', streamId: 'follow', error: { code: 'again' } })

    expect(fake.errors).toHaveLength(1)
    expect(fake.errors[0]?.message).toContain('gateway/arguments-invalid')
    expect(fake.stream.active).toBe(false)
  })

  it('ends quietly when the host closes the stream', () => {
    const fake = make()
    fake.stream.open({ address: { kind: 'session', sessionId: 's1' } })
    fake.socket.emit('open')

    fake.socket.frame({ type: 'end', streamId: 'follow' })

    expect(fake.errors).toHaveLength(0)
    expect(fake.stream.active).toBe(false)
    expect(fake.socket.closed).toBe(true)
  })

  it('ignores malformed frames instead of crashing the mux', () => {
    const fake = make()
    fake.stream.open({ address: { kind: 'session', sessionId: 's1' } })
    fake.socket.emit('open')

    const spy = vi.fn()
    fake.socket.on('message', spy)
    fake.socket.emit('message', 'not json')

    expect(fake.errors).toHaveLength(1)
    expect(fake.errors[0]?.message).toContain('非 JSON')
  })
})
