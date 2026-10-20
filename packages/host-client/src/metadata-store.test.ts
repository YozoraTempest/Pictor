import { describe, expect, it } from 'vitest'

import type { RpcTransport } from '@pictor/racp'

import { HostCoreClient } from './metadata-store.js'

class RecordingTransport implements RpcTransport {
  readonly sent: Array<{ id: number; method: string; params?: unknown }> = []
  readonly #lineListeners = new Set<(line: string) => void>()

  send(line: string): void {
    this.sent.push(JSON.parse(line) as { id: number; method: string; params?: unknown })
  }

  onLine(listener: (line: string) => void): () => void {
    this.#lineListeners.add(listener)
    return () => this.#lineListeners.delete(listener)
  }

  onClose(): () => void {
    return () => undefined
  }

  close(): void {}

  respond(result: unknown): void {
    const request = this.sent[this.sent.length - 1]
    if (request === undefined) throw new Error('no request to answer')
    const line = JSON.stringify({ jsonrpc: '2.0', id: request.id, result })
    for (const listener of this.#lineListeners) listener(line)
  }
}

describe('HostCoreClient', () => {
  it('maps the project contract onto sidecar methods', async () => {
    const transport = new RecordingTransport()
    const client = new HostCoreClient(transport)

    const pending = client.addProject('/tmp/demo', 'Demo')
    expect(transport.sent[0]).toEqual({
      jsonrpc: '2.0',
      id: 1,
      method: 'project.add',
      params: { path: '/tmp/demo', name: 'Demo' },
    })

    transport.respond({ id: 'p1', path: '/tmp/demo', name: 'Demo' })
    await expect(pending).resolves.toMatchObject({ id: 'p1' })
  })

  it('omits optional params instead of sending undefined', async () => {
    const transport = new RecordingTransport()
    const client = new HostCoreClient(transport)

    const pending = client.addProject('/tmp/demo')
    expect(transport.sent[0]?.params).toEqual({ path: '/tmp/demo' })

    transport.respond({ id: 'p1' })
    await pending
  })

  it('returns settings as a record', async () => {
    const transport = new RecordingTransport()
    const client = new HostCoreClient(transport)

    const pending = client.listSettings()
    transport.respond({ 'model.id': 'demo' })

    await expect(pending).resolves.toEqual({ 'model.id': 'demo' })
  })

  it('sends plugin enable state as a boolean', async () => {
    const transport = new RecordingTransport()
    const client = new HostCoreClient(transport)

    const pending = client.setPluginEnabled('pictor.hello', false)
    expect(transport.sent[0]).toMatchObject({
      method: 'plugin.setEnabled',
      params: { id: 'pictor.hello', enabled: false },
    })

    transport.respond({ id: 'pictor.hello', enabled: false })
    await pending
  })
})
