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

/** A bridge that answers every guard question with one fixed verdict. */
function bridge(
  answer: unknown,
  extra: { providers?: unknown } = {},
): Promise<{
  port: number
  asked: Record<string, unknown>[]
  providersAsked: Record<string, unknown>[]
}> {
  const asked: Record<string, unknown>[] = []
  // The service-list question is a different one; it does not count as a guard call.
  const providersAsked: Record<string, unknown>[] = []
  const server = createServer((socket) => {
    let buffer = ''
    socket.setEncoding('utf8')
    socket.on('data', (chunk: string) => {
      buffer += chunk
      const end = buffer.indexOf('\n')
      if (end === -1) return
      const request = JSON.parse(buffer.slice(0, end)) as Record<string, unknown>
      if (request['kind'] === 'providers') providersAsked.push(request)
      else asked.push(request)
      // The extension asks two different questions on this socket; the guard verdict
      // answers only the tool-call one.
      const payload =
        request['kind'] === 'providers' ? { providers: extra.providers ?? [] } : answer
      socket.end(`${JSON.stringify(payload)}\n`)
    })
  })
  servers.push(server)
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      resolve({
        port: typeof address === 'object' && address !== null ? address.port : 0,
        asked,
        providersAsked,
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
  options: {
    annotations?: Record<string, unknown>
    confirm?: boolean
    answer?: string
  } = {},
): Promise<{
  call: (event: { toolName: string; input: unknown }) => Promise<unknown>
  ask: (params: Record<string, unknown>) => Promise<unknown>
  confirms: { title: string; message: string }[]
  asks: { title: string; options: string[] }[]
  typings: { title: string }[]
  edits: { title: string; draft: string }[]
  tools: Record<string, unknown>[]
  registered: { name: string; config: unknown }[]
}> {
  const dir = mkdtempSync(join(tmpdir(), 'pictor-pi-guard-'))
  dirs.push(dir)
  const file = writeGuardExtension(dir, endpoint)
  const module = (await import(`${file}?v=${String(Math.random())}`)) as {
    default: (pi: unknown) => void
  }

  let handler: ((event: unknown, ctx: unknown) => Promise<unknown>) | null = null
  const tools: Record<string, unknown>[] = []
  const registered: { name: string; config: unknown }[] = []
  const api = {
    on: (name: string, fn: (event: unknown, ctx: unknown) => Promise<unknown>) => {
      if (name === 'tool_call') handler = fn
      return () => undefined
    },
    registerTool: (tool: Record<string, unknown>) => {
      tools.push(tool)
    },
    registerProvider: (name: string, config: unknown) => {
      registered.push({ name, config })
    },
    getAllTools: () => [...tools, { name: 'bash', annotations: options.annotations ?? {} }],
  }
  // The factory is async now: Pi awaits it before startup continues.
  await (module.default as (pi: unknown) => Promise<void> | void)(api)

  const confirms: { title: string; message: string }[] = []
  const asks: { title: string; options: string[] }[] = []
  const typings: { title: string }[] = []
  const edits: { title: string; draft: string }[] = []
  const ctx = {
    ui: {
      confirm: async (title: string, message: string) => {
        confirms.push({ title, message })
        return options.confirm ?? false
      },
      select: async (title: string, list: string[]) => {
        asks.push({ title, options: [...list] })
        return options.answer
      },
      input: async (title: string) => {
        typings.push({ title })
        return options.answer
      },
      editor: async (title: string, draft: string) => {
        edits.push({ title, draft })
        return options.answer
      },
    },
  }

  return {
    confirms,
    asks,
    typings,
    edits,
    tools,
    registered,
    call: async (event) => {
      if (handler === null) throw new Error('the extension registered no tool_call handler')
      return handler(event, ctx)
    },
    /** Runs the asking tool the extension registered, as Pi would. */
    ask: async (params: Record<string, unknown>) => {
      const tool = tools.find((entry) => entry['name'] === 'ask_user_question') as
        | {
            execute: (
              id: string,
              p: unknown,
              s: unknown,
              u: unknown,
              c: unknown,
            ) => Promise<unknown>
          }
        | undefined
      if (tool === undefined) throw new Error('the extension registered no asking tool')
      return tool.execute('call-1', params, undefined, undefined, ctx)
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

  it('registers Pictor’s services with Pi, so one configuration serves both kernels', async () => {
    const port = await bridge(
      { block: false },
      {
        providers: [
          {
            name: 'pictor-deepseek',
            apiKey: 'sk-live',
            baseUrl: 'https://api.deepseek.com',
            models: [{ id: 'deepseek-chat', name: 'DeepSeek Chat', api: 'openai-completions' }],
          },
        ],
      },
    )
    const extension = await loadExtension({ port: port.port, token: 'secret' })

    // Pi gets the key over the socket: the extension file itself holds none.
    expect(extension.registered).toEqual([
      {
        name: 'pictor-deepseek',
        config: {
          apiKey: 'sk-live',
          baseUrl: 'https://api.deepseek.com',
          models: [{ id: 'deepseek-chat', name: 'DeepSeek Chat', api: 'openai-completions' }],
        },
      },
    ])
    expect(extension.tools.map((tool) => tool['name'])).toEqual(['ask_user_question'])
  })

  it('still guards tool calls when the service list cannot be read', async () => {
    // Nothing listening: registration fails silently, but the guard must not become a
    // hole. A tool call is still refused rather than allowed.
    const extension = await loadExtension({ port: 1, token: 'secret' })

    expect(extension.registered).toEqual([])
    expect(await extension.call({ toolName: 'bash', input: {} })).toMatchObject({
      block: true,
    })
  })

  it('registers the asking tool the model uses, and passes options to Pi', async () => {
    const port = await bridge({ block: false })
    const extension = await loadExtension({ port: port.port, token: 'secret' }, { answer: 'beta' })

    expect(extension.tools.map((tool) => tool['name'])).toEqual(['ask_user_question'])
    // Read-only, because asking is not doing: a session that asks before every
    // mutating call must not have to approve the question first.
    expect(extension.tools[0]).toMatchObject({ annotations: { readOnlyHint: true } })

    const result = (await extension.ask({
      question: '用哪个分支？',
      options: ['alpha', 'beta'],
    })) as { content: { text: string }[] }
    expect(extension.asks).toEqual([{ title: '用哪个分支？', options: ['alpha', 'beta'] }])
    expect(result.content[0]?.text).toBe('The person answered: beta')
  })

  it('asks for free text when no options were offered', async () => {
    const port = await bridge({ block: false })
    const extension = await loadExtension(
      { port: port.port, token: 'secret' },
      { answer: '修好了' },
    )

    const result = (await extension.ask({
      question: '提交说明写什么？',
      detail: '改了登录页',
    })) as { content: { text: string }[] }

    // The detail rides with the question rather than being dropped: it is the part
    // the person needs to answer at all.
    expect(extension.typings[0]?.title).toContain('改了登录页')
    expect(result.content[0]?.text).toBe('The person answered: 修好了')
  })

  it('offers a draft as an editor instead of a blank field', async () => {
    const port = await bridge({ block: false })
    const extension = await loadExtension(
      { port: port.port, token: 'secret' },
      { answer: 'feat: 改过的草稿' },
    )

    const result = (await extension.ask({
      question: '改一下这条提交说明',
      draft: 'feat: 原始草稿',
    })) as { content: { text: string }[] }

    // The draft is what the person starts from, so it has to travel to the editor.
    expect(extension.edits).toEqual([{ title: '改一下这条提交说明', draft: 'feat: 原始草稿' }])
    expect(extension.asks).toEqual([])
    expect(extension.typings).toEqual([])
    expect(result.content[0]?.text).toContain('feat: 改过的草稿')
  })

  it('treats an emptied draft as an edit, not as silence', async () => {
    const port = await bridge({ block: false })
    const extension = await loadExtension({ port: port.port, token: 'secret' }, { answer: '' })

    const result = (await extension.ask({
      question: '留着这段吗？',
      draft: 'feat: 原始草稿',
    })) as { content: { text: string }[] }

    // The person deliberately deleted the text; the model must not read that as
    // "nobody answered" and re-ask the same thing.
    expect(result.content[0]?.text).toContain('edited the draft to')
    expect(result.content[0]?.text).not.toContain('did not answer')
  })

  it('says the person did not answer instead of inventing one', async () => {
    const port = await bridge({ block: false })
    const extension = await loadExtension({ port: port.port, token: 'secret' })

    const result = (await extension.ask({ question: '继续吗？' })) as {
      content: { text: string }[]
    }

    expect(result.content[0]?.text).toContain('did not answer')
  })

  it('asks before a mutating call but not before its own question', async () => {
    const port = await bridge({ block: false, ask: { tool: 'bash', reason: '先问一句' } })
    const extension = await loadExtension({ port: port.port, token: 'secret' }, { confirm: true })

    await extension.call({ toolName: 'bash', input: { command: 'ls' } })
    // The asking tool declares itself read-only, so Pi's hints say it cannot change
    // anything and the session never has to approve a question.
    await extension.call({ toolName: 'ask_user_question', input: { question: '继续吗？' } })

    expect(port.asked.map((entry) => entry['mutating'])).toEqual([true, false])
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
