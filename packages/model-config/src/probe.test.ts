import { describe, expect, it, vi } from 'vitest'

import { fetchModels, testConnection } from './probe.js'
import type { FetchLike } from './probe.js'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('fetchModels', () => {
  it('sorts and normalises the model list', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () =>
      jsonResponse({ data: [{ id: 'b' }, { id: 'a', name: 'A' }, { nope: true }] }),
    )

    const models = await fetchModels(
      { baseUrl: 'https://api.example.com/', protocol: 'chat-completions', apiKey: 'k' },
      fetchImpl,
    )

    expect(models.map((model) => model.id)).toEqual(['a', 'b'])
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.example.com/models',
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('reports HTTP failures with the response body', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => new Response('bad key', { status: 401 }))

    await expect(
      fetchModels(
        { baseUrl: 'https://api.example.com', protocol: 'chat-completions', apiKey: null },
        fetchImpl,
      ),
    ).rejects.toThrow(/HTTP 401: bad key/)
  })
})

describe('testConnection', () => {
  it('extracts chat completion text', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () =>
      jsonResponse({ choices: [{ message: { content: 'ok' } }] }),
    )

    const result = await testConnection(
      {
        baseUrl: 'https://api.example.com',
        protocol: 'chat-completions',
        apiKey: 'secret',
        modelId: 'demo',
      },
      fetchImpl,
    )

    expect(result).toEqual({ ok: true, message: 'Connection succeeded', sample: 'ok' })

    const [, init] = fetchImpl.mock.calls[0] ?? []
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>
    expect(body).toMatchObject({ model: 'demo', max_tokens: 32 })
    expect(JSON.stringify(init?.headers)).not.toContain('secret-key')
  })

  it('extracts responses text', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () =>
      jsonResponse({ output: [{ content: [{ type: 'output_text', text: 'ok' }] }] }),
    )

    const result = await testConnection(
      { baseUrl: 'https://api.example.com', protocol: 'responses', apiKey: null, modelId: 'demo' },
      fetchImpl,
    )

    expect(result.ok).toBe(true)
    expect(result.sample).toBe('ok')
  })

  it('reports non-2xx responses', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => new Response('boom', { status: 500 }))

    const result = await testConnection(
      {
        baseUrl: 'https://api.example.com',
        protocol: 'chat-completions',
        apiKey: 'k',
        modelId: 'demo',
      },
      fetchImpl,
    )

    expect(result.ok).toBe(false)
    expect(result.message).toMatch(/HTTP 500: boom/)
  })

  it('reports network errors', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => {
      throw new Error('ECONNREFUSED')
    })

    const result = await testConnection(
      {
        baseUrl: 'https://api.example.com',
        protocol: 'chat-completions',
        apiKey: 'k',
        modelId: 'demo',
      },
      fetchImpl,
    )

    expect(result.ok).toBe(false)
    expect(result.message).toMatch(/ECONNREFUSED/)
  })

  it('requires a model id', async () => {
    const result = await testConnection({
      baseUrl: 'https://api.example.com',
      protocol: 'chat-completions',
      apiKey: null,
      modelId: '',
    })

    expect(result.ok).toBe(false)
  })
})
