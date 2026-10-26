import { connect } from 'node:net'

import { afterEach, describe, expect, it } from 'vitest'

import type { ToolGuardContribution, ToolHookContribution } from '@pictor/plugin-sdk'

import { ToolBridgeServer } from './tool-bridge-server.js'

/**
 * The bridge is where a plugin's JavaScript meets a kernel's child process, so what it is
 * tested for is the shape of its answers: a guard's refusal, a hook's note, and the fact
 * that the two questions cannot be confused for each other. Both halves ride one token
 * and one socket; a reply meant for the wrong half would be applied by the wrong side.
 */

const servers: ToolBridgeServer[] = []

afterEach(async () => {
  for (const server of servers.splice(0)) await server.stop()
})

/** One question on the bridge, answered as the app would answer it. */
async function ask(
  server: ToolBridgeServer,
  question: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const endpoint = server.endpoint
  if (endpoint === null) throw new Error('bridge not started')

  return new Promise((resolve, reject) => {
    const socket = connect({ host: '127.0.0.1', port: endpoint.port })
    let buffer = ''
    socket.setEncoding('utf8')
    socket.setTimeout(4_000, () => reject(new Error('bridge did not answer')))
    socket.on('error', reject)
    socket.on('connect', () => {
      socket.write(`${JSON.stringify({ token: endpoint.token, ...question })}\n`)
    })
    socket.on('data', (chunk: string) => {
      buffer += chunk
      const end = buffer.indexOf('\n')
      if (end === -1) return
      socket.destroy()
      resolve(JSON.parse(buffer.slice(0, end)) as Record<string, unknown>)
    })
  })
}

async function start(
  guards: ToolGuardContribution[] = [],
  hooks: ToolHookContribution[] = [],
): Promise<ToolBridgeServer> {
  const server = new ToolBridgeServer(guards, 'secret', null, null, hooks)
  servers.push(server)
  await server.start()
  return server
}

describe('ToolBridgeServer', () => {
  it('answers the guard question with a refusal, and nothing else', async () => {
    const server = await start([
      {
        id: 'acme.no-rm',
        tools: ['bash'],
        decide: () => ({ decision: 'deny', reason: '不要 rm' }),
      },
    ])

    expect(await ask(server, { tool: 'bash', args: { command: 'rm -rf /' } })).toEqual({
      block: true,
      reason: '不要 rm',
    })
  })

  it('fails closed for a guard that throws', async () => {
    const server = await start([
      {
        id: 'acme.broken',
        decide: () => {
          throw new Error('boom')
        },
      },
    ])

    const reply = await ask(server, { tool: 'bash', args: {} })
    expect(reply['block']).toBe(true)
    expect(String(reply['reason'])).toContain('boom')
  })

  it('answers the after question from the hooks, with the note and nothing blocked', async () => {
    const server = await start(
      [],
      [
        {
          id: 'acme.lint',
          tools: ['bash'],
          after: (context) =>
            context.output.includes('warning') ? { note: '有一条告警' } : undefined,
        },
      ],
    )

    expect(
      await ask(server, { kind: 'after', tool: 'bash', args: {}, ok: true, output: 'warning: x' }),
    ).toEqual({ note: '[acme.lint] 有一条告警' })
    // Nothing to say is an answer too: the kernel keeps the result it already has.
    expect(
      await ask(server, { kind: 'after', tool: 'bash', ok: true, output: 'all good' }),
    ).toEqual({})
  })

  it('passes a hook’s failure through under the same question', async () => {
    const server = await start([], [{ id: 'acme.strict', after: () => ({ fail: '换个做法' }) }])

    expect(await ask(server, { kind: 'after', tool: 'read', ok: true, output: '' })).toEqual({
      fail: '[acme.strict] 换个做法',
    })
  })

  it('keeps a hook’s own error out of the answer', async () => {
    // Fail open: a hook that throws costs its own contribution, not the conversation.
    const server = await start(
      [],
      [
        {
          id: 'acme.broken',
          after: () => {
            throw new Error('boom')
          },
        },
      ],
    )

    expect(await ask(server, { kind: 'after', tool: 'bash', ok: true, output: 'ok' })).toEqual({})
  })

  it('refuses a question that does not carry the token', async () => {
    const server = await start()
    const endpoint = server.endpoint
    if (endpoint === null) throw new Error('bridge not started')

    const reply = await new Promise<Record<string, unknown>>((resolve, reject) => {
      const socket = connect({ host: '127.0.0.1', port: endpoint.port })
      let buffer = ''
      socket.setEncoding('utf8')
      socket.on('error', reject)
      socket.on('connect', () => {
        socket.write(`${JSON.stringify({ token: 'guessed', kind: 'after', tool: 'bash' })}\n`)
      })
      socket.on('data', (chunk: string) => {
        buffer += chunk
        const end = buffer.indexOf('\n')
        if (end === -1) return
        socket.destroy()
        resolve(JSON.parse(buffer.slice(0, end)) as Record<string, unknown>)
      })
    })

    expect(reply['block']).toBe(true)
    expect(String(reply['reason'])).toContain('未认证')
  })
})
