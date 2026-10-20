import { describe, expect, it, vi } from 'vitest'

import { RpcClient } from './client.js'
import type { RpcTransport } from './client.js'
import { RpcError } from './frame.js'

class FakeTransport implements RpcTransport {
  readonly sent: string[] = []
  readonly #lineListeners = new Set<(line: string) => void>()
  readonly #closeListeners = new Set<(error: Error) => void>()
  closed = false

  send(line: string): void {
    this.sent.push(line)
  }

  onLine(listener: (line: string) => void): () => void {
    this.#lineListeners.add(listener)
    return () => this.#lineListeners.delete(listener)
  }

  onClose(listener: (error: Error) => void): () => void {
    this.#closeListeners.add(listener)
    return () => this.#closeListeners.delete(listener)
  }

  close(): void {
    this.closed = true
  }

  emit(line: string): void {
    for (const listener of this.#lineListeners) listener(line)
  }

  emitClose(error: Error): void {
    for (const listener of this.#closeListeners) listener(error)
  }
}

describe('RpcClient', () => {
  it('correlates responses by id', async () => {
    const transport = new FakeTransport()
    const client = new RpcClient(transport)

    const promise = client.request('system.ping', { a: 1 })
    expect(JSON.parse(transport.sent[0] ?? '{}')).toMatchObject({
      jsonrpc: '2.0',
      id: 1,
      method: 'system.ping',
      params: { a: 1 },
    })

    transport.emit('{"jsonrpc":"2.0","id":1,"result":{"ok":true}}')
    await expect(promise).resolves.toEqual({ ok: true })
  })

  it('rejects with RpcError for error frames', async () => {
    const transport = new FakeTransport()
    const client = new RpcClient(transport)

    const promise = client.request('project.remove')
    transport.emit('{"jsonrpc":"2.0","id":1,"error":{"code":-32004,"message":"missing"}}')

    await expect(promise).rejects.toBeInstanceOf(RpcError)
    await expect(promise).rejects.toMatchObject({ code: -32004 })
  })

  it('ignores frames for unknown ids', async () => {
    const transport = new FakeTransport()
    const client = new RpcClient(transport)

    transport.emit('{"jsonrpc":"2.0","id":99,"result":null}')

    const promise = client.request('system.ping')
    transport.emit('{"jsonrpc":"2.0","id":1,"result":null}')
    await expect(promise).resolves.toBeNull()
  })

  it('rejects pending requests when the transport closes', async () => {
    const transport = new FakeTransport()
    const client = new RpcClient(transport)

    const promise = client.request('system.ping')
    transport.emitClose(new Error('process died'))

    await expect(promise).rejects.toThrow(/process died/)
  })

  it('times out unanswered requests', async () => {
    vi.useFakeTimers()
    const transport = new FakeTransport()
    const client = new RpcClient(transport, 50)

    const promise = client.request('system.ping')
    const assertion = expect(promise).rejects.toThrow(/timed out/)
    await vi.advanceTimersByTimeAsync(60)
    await assertion

    vi.useRealTimers()
  })

  it('rejects new requests after disposal', async () => {
    const transport = new FakeTransport()
    const client = new RpcClient(transport)
    client.dispose()

    await expect(client.request('system.ping')).rejects.toThrow(/disposed/)
    expect(transport.closed).toBe(true)
  })
})
