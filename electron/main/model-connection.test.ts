// @vitest-environment node

import { describe, expect, it, vi } from 'vitest'

import type { ModelSettingsInput } from '../../src/shared/contracts.js'
import { ModelConnectionTester } from './model-connection.js'

const settings: ModelSettingsInput = {
  apiProtocol: 'chat-completions',
  baseUrl: 'https://example.test/v1',
  modelId: 'test-model',
  reasoningEffort: null,
  temperature: null,
  maxOutputTokens: null,
}

function eventStream(event: unknown): Response {
  return new Response(`data: ${JSON.stringify(event)}\n\ndata: [DONE]\n\n`, {
    status: 200,
    headers: { 'content-type': 'text/event-stream; charset=utf-8' },
  })
}

describe('ModelConnectionTester', () => {
  it('requires a real Chat Completions tool call before reporting success', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      eventStream({
        choices: [
          {
            delta: {
              tool_calls: [{ function: { name: 'pictor_connection_test', arguments: '{}' } }],
            },
          },
        ],
      }),
    )
    const tester = new ModelConnectionTester(fetchMock)

    await expect(tester.test(settings, 'secret')).resolves.toEqual({
      outcome: 'success',
      message: '连接成功，已验证 Chat Completions 流式工具调用',
    })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.test/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"tool_choice":{"type":"function"'),
      }),
    )
  })

  it('probes Responses tool calls and configured reasoning effort', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      eventStream({
        type: 'response.output_item.added',
        item: { type: 'function_call', name: 'pictor_connection_test', arguments: '{}' },
      }),
    )
    const tester = new ModelConnectionTester(fetchMock)

    await expect(
      tester.test({ ...settings, apiProtocol: 'responses', reasoningEffort: 'xhigh' }, 'secret'),
    ).resolves.toEqual({
      outcome: 'success',
      message: '连接成功，已验证 Responses 流式工具调用',
    })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.test/v1/responses',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"reasoning":{"effort":"xhigh"}'),
      }),
    )
  })

  it('rejects a valid text stream that ignores the forced tool call', async () => {
    const tester = new ModelConnectionTester(
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          eventStream({ choices: [{ delta: { content: 'OK' }, finish_reason: 'stop' }] }),
        ),
    )

    await expect(tester.test(settings, 'secret')).resolves.toEqual({
      outcome: 'incompatible',
      message: 'Chat Completions 端点可以流式响应，但未执行指定工具调用',
    })
  })

  it('rejects malformed or wrong-protocol SSE events', async () => {
    const tester = new ModelConnectionTester(
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response('data: {invalid}\n\n', {
          headers: { 'content-type': 'text/event-stream' },
        }),
      ),
    )

    await expect(tester.test(settings, 'secret')).resolves.toEqual({
      outcome: 'incompatible',
      message: 'Chat Completions 端点未返回可解析的协议事件',
    })
  })

  it.each([
    [401, 'authentication'],
    [404, 'model'],
    [500, 'server'],
  ] as const)('classifies HTTP %s as %s', async (status, outcome) => {
    const tester = new ModelConnectionTester(
      vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status })),
    )
    expect((await tester.test(settings, 'secret')).outcome).toBe(outcome)
  })

  it('distinguishes an incompatible non-streaming endpoint', async () => {
    const tester = new ModelConnectionTester(
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
        ),
    )
    await expect(tester.test(settings, 'secret')).resolves.toEqual({
      outcome: 'incompatible',
      message:
        'Chat Completions 端点未返回 SSE 流；请确认 Base URL 是 API 根地址（通常以 /v1 结尾）',
    })
  })

  it('fetches, de-duplicates, and sorts OpenAI-compatible model ids', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json({ data: [{ id: 'gpt-5.6-sol' }, { id: 'gpt-4.1' }, { id: 'gpt-5.6-sol' }] }),
      )
    const tester = new ModelConnectionTester(fetchMock)

    await expect(tester.listModels(settings.baseUrl, 'secret')).resolves.toEqual({
      outcome: 'success',
      message: '已获取 2 个可用模型',
      models: ['gpt-4.1', 'gpt-5.6-sol'],
    })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.test/v1/models',
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('reports a non-compatible model catalog payload', async () => {
    const tester = new ModelConnectionTester(
      vi.fn<typeof fetch>().mockResolvedValue(Response.json({ models: ['test-model'] })),
    )
    expect((await tester.listModels(settings.baseUrl, 'secret')).outcome).toBe('incompatible')
  })

  it('classifies transport failures as connectivity errors', async () => {
    const tester = new ModelConnectionTester(
      vi.fn<typeof fetch>().mockRejectedValue(new TypeError('network failure')),
    )
    expect((await tester.test(settings, 'secret')).outcome).toBe('connectivity')
    expect((await tester.listModels(settings.baseUrl, 'secret')).outcome).toBe('connectivity')
  })
})
