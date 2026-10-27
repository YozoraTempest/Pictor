import { DSH } from './wire.js'
import { describe, expect, it } from 'vitest'

import { HarnessRemote } from './remote.js'

/** A fetch that answers from a table of suffix → response, recording requests. */
function fakeFetch(routes: { match: string; respond: () => Response }[]): {
  fetch: typeof fetch
  calls: { url: string; init: RequestInit | undefined }[]
} {
  const calls: { url: string; init: RequestInit | undefined }[] = []
  const respond = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, init })
    for (const route of routes) {
      if (url.includes(route.match)) return route.respond()
    }
    throw new Error(`unexpected fetch: ${url}`)
  }) as typeof fetch
  return { fetch: respond, calls }
}

describe('HarnessRemote', () => {
  it('exchanges the boot token for the session cookie', async () => {
    const { fetch, calls } = fakeFetch([
      {
        match: '/?token=',
        respond: () =>
          new Response(null, {
            status: 303,
            headers: { 'set-cookie': 'dsh-auth-abc; Path=/; HttpOnly; SameSite=Strict' },
          }),
      },
    ])
    const remote = new HarnessRemote({ baseUrl: 'http://127.0.0.1:4242', token: 'tok', fetch })
    await remote.connect()

    expect(remote.cookie).toBe('dsh-auth-abc')
    expect(calls[0]?.url).toBe('http://127.0.0.1:4242/?token=tok')
    // The redirect is read for its cookie, never followed.
    expect(calls[0]?.init?.redirect).toBe('manual')
  })

  it('fails loudly when the runtime does not set a cookie', async () => {
    const { fetch } = fakeFetch([
      { match: '/?token=', respond: () => new Response('forbidden', { status: 401 }) },
    ])
    const remote = new HarnessRemote({ baseUrl: 'http://127.0.0.1:4242', token: 'bad', fetch })
    await expect(remote.connect()).rejects.toThrow('没有接受启动令牌')
  })

  it('sends the descriptor envelope and unwraps the value', async () => {
    const { fetch, calls } = fakeFetch([
      {
        match: '/?token=',
        respond: () => new Response(null, { status: 303, headers: { 'set-cookie': 'c=1' } }),
      },
      {
        match: '/api/session/prompt',
        respond: () =>
          Response.json({
            type: 'server-response',
            rpcId: 'x',
            result: { ok: true, value: { accepted: true } },
          }),
      },
    ])
    const remote = new HarnessRemote({ baseUrl: 'http://127.0.0.1:4242', token: 'tok', fetch })
    await remote.connect()
    const value = await remote.call<{ accepted: true }>(DSH.session.prompt, {
      request: { sessionId: 's' },
    })

    expect(value).toEqual({ accepted: true })
    const post = calls.at(-1)
    expect(post?.url).toBe('http://127.0.0.1:4242/api/session/prompt')
    expect((post?.init?.headers as Record<string, string>)['cookie']).toBe('c=1')
    const body = JSON.parse(String(post?.init?.body)) as {
      type: string
      method: string
      payload: unknown
    }
    expect(body.type).toBe('client-request')
    expect(body.method).toBe(DSH.session.prompt)
    expect(body.payload).toEqual({ args: { request: { sessionId: 's' } } })
  })

  it('surfaces the runtime failure code instead of a bare message', async () => {
    const { fetch } = fakeFetch([
      {
        match: '/?token=',
        respond: () => new Response(null, { status: 303, headers: { 'set-cookie': 'c=1' } }),
      },
      {
        match: '/api/session/create',
        respond: () =>
          Response.json({
            type: 'server-response',
            rpcId: 'x',
            result: {
              ok: false,
              error: {
                code: 'gateway/arguments-invalid',
                message: 'args fields do not match the descriptor',
                details: {},
              },
            },
          }),
      },
    ])
    const remote = new HarnessRemote({ baseUrl: 'http://127.0.0.1:4242', token: 'tok', fetch })
    await remote.connect()

    await expect(remote.call(DSH.session.create, {})).rejects.toThrow(
      'gateway/arguments-invalid: args fields do not match the descriptor',
    )
  })

  it('refuses to call before connecting', async () => {
    const remote = new HarnessRemote({ baseUrl: 'http://127.0.0.1:4242', token: 'tok' })
    await expect(remote.call(DSH.session.create, {})).rejects.toThrow('尚未完成认证')
  })
})
