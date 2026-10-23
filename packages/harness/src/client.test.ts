import { EventEmitter } from 'node:events'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'

import { describe, expect, it, vi } from 'vitest'

import { HarnessClient, type HarnessClientOptions, type HarnessNotification } from './client.js'
import type { JsonRpcRequest } from './protocol.js'

interface FakeRuntime {
  child: ChildProcessWithoutNullStreams
  writes: JsonRpcRequest[]
  reply: (payload: object) => void
  notify: (payload: object) => void
  /** Write a raw line, for malformed input. */
  raw: (line: string) => void
  exit: (code?: number) => void
}

/**
 * A stand-in for the `dsh --profile sdk` process.
 *
 * The protocol is the contract, so the fake speaks it directly: it parses what
 * the client writes and lets each test answer as the real runtime would.
 */
function createFakeRuntime(
  handle: (message: JsonRpcRequest, runtime: FakeRuntime) => void = () => undefined,
): FakeRuntime {
  const stdin = new PassThrough()
  const stdout = new PassThrough()
  const stderr = new PassThrough()
  const events = new EventEmitter()
  const writes: JsonRpcRequest[] = []
  let buffer = ''

  const runtime = {
    writes,
    reply: (payload: object) => {
      stdout.write(`${JSON.stringify(payload)}\n`)
    },
    notify: (payload: object) => {
      stdout.write(`${JSON.stringify(payload)}\n`)
    },
    raw: (line: string) => {
      stdout.write(line)
    },
    exit: (code = 0) => {
      events.emit('exit', code, null)
    },
  } as FakeRuntime

  stdin.on('data', (chunk: Buffer | string) => {
    buffer += String(chunk)
    let index = buffer.indexOf('\n')
    while (index >= 0) {
      const line = buffer.slice(0, index).trim()
      buffer = buffer.slice(index + 1)
      if (line.length > 0) {
        const message = JSON.parse(line) as JsonRpcRequest
        writes.push(message)
        handle(message, runtime)
      }
      index = buffer.indexOf('\n')
    }
  })

  const child = Object.assign(events, {
    stdin,
    stdout,
    stderr,
    kill: vi.fn(() => true),
  })

  runtime.child = child as unknown as ChildProcessWithoutNullStreams
  return runtime
}

function clientFor(
  runtime: FakeRuntime,
  overrides: Partial<HarnessClientOptions> = {},
): HarnessClient {
  return new HarnessClient({
    binary: '/fake/dsh',
    home: mkdtempSync(join(tmpdir(), 'pictor-harness-')),
    provider: 'deepseek-official',
    model: 'deepseek-flash',
    spawn: () => runtime.child,
    ...overrides,
  })
}

/** Answer the handshake, so a test can get past `start()`. */
function handshake(runtime: FakeRuntime): void {
  runtime.reply({
    jsonrpc: '2.0',
    id: runtime.writes[0]?.id ?? 0,
    result: { serverInfo: { name: 'deepseek-harness-sdk-runtime', version: '0.0.1' } },
  })
}

describe('HarnessClient', () => {
  it('completes the handshake with the route and directory it was given', async () => {
    const runtime = createFakeRuntime()
    const client = clientFor(runtime)

    const started = client.start('/work/project')
    handshake(runtime)
    const result = await started

    expect(result.serverInfo.name).toBe('deepseek-harness-sdk-runtime')
    expect(runtime.writes[0]).toMatchObject({
      jsonrpc: '2.0',
      method: 'initialize',
      params: { cwd: '/work/project', provider: 'deepseek-official', model: 'deepseek-flash' },
    })
  })

  it('sends a prompt and waits for the session to go idle', async () => {
    const runtime = createFakeRuntime((message, self) => {
      if (message.method === 'initialize') handshake(self)
      else self.reply({ jsonrpc: '2.0', id: message.id, result: {} })
    })
    const client = clientFor(runtime)
    await client.start('/work')

    await client.prompt('s1', [{ type: 'text', text: 'ping' }])
    await client.waitForIdle('s1')

    expect(runtime.writes.map((entry) => entry.method)).toEqual([
      'initialize',
      'session/prompt',
      'session/wait',
    ])
    expect(runtime.writes[1]?.params).toEqual({
      sessionId: 's1',
      contentBlocks: [{ type: 'text', text: 'ping' }],
    })
  })

  it('normalises notification names to the wire spelling', async () => {
    const runtime = createFakeRuntime((message, self) => {
      if (message.method === 'initialize') handshake(self)
    })
    const client = clientFor(runtime)
    const seen: HarnessNotification[] = []
    client.onNotification((notification) => seen.push(notification))
    await client.start('/work')

    runtime.notify({
      jsonrpc: '2.0',
      method: 'session/event',
      params: { event: { type: 'turn/start' } },
    })

    expect(seen.at(-1)).toMatchObject({ method: 'session.event' })
  })

  it('rejects when the runtime answers with an error', async () => {
    const runtime = createFakeRuntime((message, self) => {
      if (message.method === 'initialize') handshake(self)
      else self.reply({ jsonrpc: '2.0', id: message.id, error: { code: -32603, message: 'boom' } })
    })
    const client = clientFor(runtime)
    await client.start('/work')

    await expect(client.prompt('s1', [{ type: 'text', text: 'x' }])).rejects.toThrow(/boom/)
  })

  it('fails in-flight calls when the runtime exits instead of hanging them', async () => {
    const runtime = createFakeRuntime((message, self) => {
      if (message.method === 'initialize') handshake(self)
      // A prompt that never answers, then the process dies.
    })
    const client = clientFor(runtime)
    await client.start('/work')

    const pending = client.prompt('s1', [{ type: 'text', text: 'x' }])
    runtime.exit(1)

    await expect(pending).rejects.toThrow(/runtime exited/)
    expect(client.running).toBe(false)
  })

  it('survives a malformed line and keeps the channel usable', async () => {
    const runtime = createFakeRuntime((message, self) => {
      if (message.method === 'initialize') handshake(self)
      else self.reply({ jsonrpc: '2.0', id: message.id, result: {} })
    })
    const client = clientFor(runtime)
    const seen: HarnessNotification[] = []
    client.onNotification((notification) => seen.push(notification))
    await client.start('/work')

    runtime.raw('this line is not json\n')
    await client.prompt('s1', [{ type: 'text', text: 'still works' }])

    expect(seen.some((entry) => entry.method === 'runtime.malformed')).toBe(true)
    expect(runtime.writes.at(-1)?.method).toBe('session/prompt')
  })

  it('asks the runtime to shut down before signalling it', async () => {
    const runtime = createFakeRuntime((message, self) => {
      if (message.method === 'initialize') handshake(self)
      else self.reply({ jsonrpc: '2.0', id: message.id, result: {} })
    })
    const client = clientFor(runtime)
    await client.start('/work')

    await client.stop()

    expect(runtime.writes.at(-1)?.method).toBe('shutdown')
    expect(runtime.child.kill).toHaveBeenCalled()
  })
})
