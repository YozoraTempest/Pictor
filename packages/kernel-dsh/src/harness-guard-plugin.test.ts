import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { GUARD_PLUGIN_SOURCE } from './harness-guard-plugin.js'

/**
 * The generated plugin is code that runs inside dsh, so the only honest test is to run
 * it: a real loopback bridge, a real import of the generated file, and the handlers the
 * runtime would call.
 *
 * Both halves are here because they disagree on purpose. A guard that cannot reach the
 * app refuses the call; a hook that cannot reach it leaves the result alone. Getting that
 * backwards would either block every call the moment the bridge hiccups or let a policy
 * silently stop applying.
 */

const dirs: string[] = []
const servers: Server[] = []

afterEach(async () => {
  for (const server of servers.splice(0)) {
    await new Promise<void>((done) => server.close(() => done()))
  }
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** The plugin file as dsh would load it, in a directory of its own. */
function pluginFile(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pictor-dsh-guard-'))
  dirs.push(dir)
  const file = join(dir, 'index.mjs')
  writeFileSync(file, GUARD_PLUGIN_SOURCE, 'utf8')
  return file
}

/** A bridge that answers every question with one fixed payload. */
function bridge(answer: unknown): Promise<{ port: number; asked: Record<string, unknown>[] }> {
  const asked: Record<string, unknown>[] = []
  const server = createServer((socket) => {
    let buffer = ''
    socket.setEncoding('utf8')
    socket.on('data', (chunk: string) => {
      buffer += chunk
      const end = buffer.indexOf('\n')
      if (end === -1) return
      asked.push(JSON.parse(buffer.slice(0, end)) as Record<string, unknown>)
      socket.end(`${JSON.stringify(answer ?? null)}\n`)
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
 * A port with nothing behind it.
 *
 * The realistic failure is not "no bridge was configured" — that means the plugin was
 * never inserted — but "the app is gone while the runtime keeps running": a real port
 * that no longer answers. This is the case where failing closed and failing open have to
 * differ.
 */
async function deadEndpoint(): Promise<{ port: number; token: string }> {
  const server = createServer()
  const port = await new Promise<number>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      resolve(typeof address === 'object' && address !== null ? address.port : 0)
    })
  })
  await new Promise<void>((done) => server.close(() => done()))
  return { port, token: 'secret' }
}

/** Loads the plugin the way dsh does and captures the two handlers it registers. */
async function loadPlugin(endpoint: { port: number; token: string } | null): Promise<{
  before: (exec: unknown, next: () => Promise<unknown>) => Promise<unknown>
  after: (exec: unknown, result: unknown, next: () => Promise<unknown>) => Promise<unknown>
}> {
  const module = (await import(`${pluginFile()}?v=${String(Math.random())}`)) as {
    apply: (ctx: unknown, config: unknown) => void
  }

  const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>()
  const ctx = {
    on: (name: string, fn: (...args: unknown[]) => Promise<unknown>) => {
      handlers.set(name, fn)
      return () => undefined
    },
  }
  module.apply(ctx, endpoint === null ? {} : { port: endpoint.port, token: endpoint.token })

  const before = handlers.get('tools/pre-execute')
  const after = handlers.get('tools/post-execute')
  if (before === undefined || after === undefined) {
    throw new Error('the plugin did not register both halves')
  }
  return {
    before: async (exec, next) => before(exec, next),
    after: async (exec, result, next) => after(exec, result, next),
  }
}

/** The decision `next()` would produce for an accepted result. */
const accept = (text: string) => () =>
  Promise.resolve({ kind: 'accept', content: [{ type: 'text', text }] })

describe('the generated guard plugin', () => {
  it('is JavaScript dsh can parse', () => {
    // A template literal that lost an escape would still typecheck here and fail only
    // inside the runtime, where the failure is a plugin that never mounted.
    expect(() => execFileSync(process.execPath, ['--check', pluginFile()])).not.toThrow()
  })

  it('denies a call the bridge refuses', async () => {
    const front = await bridge({ block: true, reason: '被工具规则拦截：bash(rm *)' })
    const plugin = await loadPlugin({ port: front.port, token: 'secret' })

    expect(
      await plugin.before({ name: 'bash', arguments: { command: 'rm -rf /' } }, () =>
        Promise.resolve({ kind: 'allow' }),
      ),
    ).toEqual({ kind: 'deny', reason: '被工具规则拦截：bash(rm *)' })
    expect(front.asked).toEqual([{ token: 'secret', tool: 'bash', args: { command: 'rm -rf /' } }])
  })

  it('registers nothing at all when no bridge was configured', async () => {
    // No port in the config means the plugin was never wired into this profile — not
    // that the app is unreachable. It stays out of the pipeline instead of half-working.
    const module = (await import(`${pluginFile()}?v=${String(Math.random())}`)) as {
      apply: (ctx: unknown, config: unknown) => void
    }
    const registered: string[] = []
    module.apply({ on: (name: string) => registered.push(name) }, {})

    expect(registered).toEqual([])
  })

  it('fails closed when the guard half cannot reach the app', async () => {
    const plugin = await loadPlugin(await deadEndpoint())

    expect(
      await plugin.before({ name: 'bash', arguments: {} }, () =>
        Promise.resolve({ kind: 'allow' }),
      ),
    ).toEqual({ kind: 'deny', reason: '工具守卫无法连接 Pictor，按默认拒绝处理' })
  })

  it('appends a hook’s note to the accepted result', async () => {
    const front = await bridge({ note: '[acme.lint] 有一处未使用变量' })
    const plugin = await loadPlugin({ port: front.port, token: 'secret' })

    const decision = await plugin.after(
      { name: 'bash', arguments: { command: 'npm test' } },
      { isError: false, content: [{ type: 'text', text: 'ok' }] },
      accept('ok'),
    )

    expect(decision).toEqual({
      kind: 'accept',
      content: [
        { type: 'text', text: 'ok' },
        { type: 'text', text: '[acme.lint] 有一处未使用变量' },
      ],
    })
    // The hook is asked about the call that finished, not about what may run.
    expect(front.asked[0]).toEqual({
      token: 'secret',
      kind: 'after',
      tool: 'bash',
      args: { command: 'npm test' },
      ok: true,
      output: 'ok',
    })
  })

  it('turns the outcome into feedback that still carries what happened', async () => {
    const front = await bridge({ fail: '[acme.guard] 不要用 npm publish' })
    const plugin = await loadPlugin({ port: front.port, token: 'secret' })

    const decision = (await plugin.after(
      { name: 'bash', arguments: { command: 'npm publish' } },
      { isError: false, content: [{ type: 'text', text: 'published 1.2.3' }] },
      accept('published 1.2.3'),
    )) as { kind: string; feedback: { text: string }[] }

    expect(decision.kind).toBe('block')
    expect(decision.feedback[0]?.text).toContain('[acme.guard] 不要用 npm publish')
    // The call already ran; the model is told what it did as well as what not to do.
    expect(decision.feedback[0]?.text).toContain('published 1.2.3')
  })

  it('leaves the result alone when the hook half cannot reach the app', async () => {
    const plugin = await loadPlugin(await deadEndpoint())

    // Fail open: a hook cannot grant or deny, so its absence costs nothing.
    expect(
      await plugin.after(
        { name: 'bash', arguments: {} },
        { isError: false, content: [{ type: 'text', text: 'ok' }] },
        accept('ok'),
      ),
    ).toEqual({ kind: 'accept', content: [{ type: 'text', text: 'ok' }] })
  })
})
