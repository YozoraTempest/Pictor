import { createServer, type Server } from 'node:net'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { guardExtensionSource, writeGuardExtension } from './pi-guard-extension.js'

/**
 * The generated extension is code that runs inside Pi, so the only honest test is
 * to run it: a real loopback server, a real import of the generated file, and the
 * handler Pi would call. A guard that silently allowed everything would look
 * exactly like a guard that worked, from the outside.
 */

const dirs: string[] = []
const servers: Server[] = []

afterEach(async () => {
  for (const server of servers.splice(0))
    await new Promise<void>((done) => server.close(() => done()))
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** A bridge that answers every call with one fixed verdict. */
function bridge(answer: unknown): Promise<{ port: number; asked: unknown[] }> {
  const asked: unknown[] = []
  const server = createServer((socket) => {
    let buffer = ''
    socket.setEncoding('utf8')
    socket.on('data', (chunk: string) => {
      buffer += chunk
      const end = buffer.indexOf('\n')
      if (end === -1) return
      asked.push(JSON.parse(buffer.slice(0, end)))
      socket.end(`${JSON.stringify(answer)}\n`)
    })
  })
  servers.push(server)
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      resolve({
        port: typeof address === 'object' && address !== null ? address.port : 0,
        asked,
      })
    })
  })
}

/**
 * Loads the generated extension the way Pi does, and captures its handler.
 *
 * `confirm` is what Pi's own dialog would answer, and `annotations` are the tool's
 * hints: both are inputs the extension reads, so a test that stubs them is testing
 * the same code path a real turn takes.
 */
async function loadExtension(
  endpoint: { port: number; token: string } | null,
  options: { annotations?: Record<string, unknown>; confirm?: boolean } = {},
): Promise<{
  call: (event: { toolName: string; input: unknown }) => Promise<unknown>
  confirms: { title: string; message: string }[]
}> {
  const dir = mkdtempSync(join(tmpdir(), 'pictor-pi-guard-'))
  dirs.push(dir)
  const file = writeGuardExtension(dir, endpoint)
  const module = (await import(`${file}?v=${String(Math.random())}`)) as {
    default: (pi: unknown) => void
  }

  let handler: ((event: unknown, ctx: unknown) => Promise<unknown>) | null = null
  const api = {
    on: (name: string, fn: (event: unknown, ctx: unknown) => Promise<unknown>) => {
      if (name === 'tool_call') handler = fn
      return () => undefined
    },
    getAllTools: () => [{ name: 'bash', annotations: options.annotations ?? {} }],
  }
  module.default(api)

  const confirms: { title: string; message: string }[] = []
  const ctx = {
    ui: {
      confirm: async (title: string, message: string) => {
        confirms.push({ title, message })
        return options.confirm ?? false
      },
    },
  }

  return {
    confirms,
    call: async (event) => {
      if (handler === null) throw new Error('the extension registered no tool_call handler')
      return handler(event, ctx)
    },
  }
}

describe('guardExtensionSource', () => {
  it('blocks a call the bridge refuses', async () => {
    const port = await bridge({ block: true, reason: '被工具规则拦截：bash(rm *)' })
    const extension = await loadExtension({ port: port.port, token: 'secret' })

    expect(await extension.call({ toolName: 'bash', input: { command: 'rm -rf /' } })).toEqual({
      block: true,
      reason: '被工具规则拦截：bash(rm *)',
    })
    // The bridge needs the tool and its arguments to decide at all, the token to know
    // this request came from a child Pictor started, and `hold` to know whether an
    // answer of "ask a person" could be carried out by this caller.
    expect(port.asked).toEqual([
      {
        token: 'secret',
        tool: 'bash',
        args: { command: 'rm -rf /' },
        hold: true,
        // No annotations here, so the extension reports it as able to change
        // something — the cautious reading of a tool nobody described.
        mutating: true,
        session: null,
      },
    ])
  })

  it('lets an allowed call through untouched', async () => {
    const port = await bridge({ block: false })
    const extension = await loadExtension({ port: port.port, token: 'secret' })

    expect(await extension.call({ toolName: 'read', input: { path: 'a.txt' } })).toBeUndefined()
  })

  it('holds the call in Pi’s own dialog when Pictor says to ask', async () => {
    const port = await bridge({
      block: false,
      ask: { tool: 'bash', reason: '工具规则「bash(rm *)」要求这次调用先问你' },
    })
    const extension = await loadExtension({ port: port.port, token: 'secret' }, { confirm: true })

    expect(await extension.call({ toolName: 'bash', input: { command: 'rm -rf build' } })).toBe(
      undefined,
    )
    // Pictor's words, not the extension's: one place decides what the person reads.
    expect(extension.confirms).toEqual([
      { title: 'bash', message: '工具规则「bash(rm *)」要求这次调用先问你' },
    ])
  })

  it('blocks the call when the person declines', async () => {
    const port = await bridge({ block: false, ask: { tool: 'bash', reason: '先问你一句' } })
    const extension = await loadExtension({ port: port.port, token: 'secret' }, { confirm: false })

    expect(await extension.call({ toolName: 'bash', input: {} })).toMatchObject({
      block: true,
      reason: expect.stringContaining('拒绝'),
    })
  })

  it('reports a tool that declares itself read-only as unable to change anything', async () => {
    const port = await bridge({ block: false })
    const extension = await loadExtension(
      { port: port.port, token: 'secret' },
      { annotations: { readOnlyHint: true } },
    )

    await extension.call({ toolName: 'bash', input: {} })
    expect(port.asked[0]).toMatchObject({ mutating: false })
  })

  it('names the conversation it is asking for', async () => {
    // The app decides per conversation, so the child has to say which one it is.
    process.env['PICTOR_SESSION'] = 'session-1'
    try {
      const port = await bridge({ block: false })
      const extension = await loadExtension({ port: port.port, token: 'secret' })

      await extension.call({ toolName: 'read', input: {} })
      expect(port.asked[0]).toMatchObject({ session: 'session-1' })
    } finally {
      delete process.env['PICTOR_SESSION']
    }
  })

  it('fails closed when Pictor cannot be reached', async () => {
    // Nothing is listening on this port: the guard exists to watch these calls, so
    // silence must not read as permission.
    const extension = await loadExtension({ port: 1, token: 'secret' })

    expect(await extension.call({ toolName: 'bash', input: {} })).toMatchObject({
      block: true,
      reason: expect.stringContaining('无法连接 Pictor'),
    })
  })

  it('fails closed before the bridge is up', async () => {
    const extension = await loadExtension(null)

    expect(await extension.call({ toolName: 'write', input: {} })).toMatchObject({ block: true })
  })

  it('still produces a loadable file when there is no bridge', () => {
    // The source is still valid JavaScript with no endpoint: Pi loads it, and the
    // guard simply has nothing to ask. This is the shape a broken profile gets.
    expect(guardExtensionSource(null)).toContain('const endpoint = null')
  })
})
