// @vitest-environment node

import { describe, expect, it, vi } from 'vitest'

import type { ModelSettingsInput } from '../../src/shared/contracts.js'
import { ModelConnectionTester } from './model-connection.js'

const settings: ModelSettingsInput = {
  baseUrl: 'https://example.test/v1',
  modelId: 'test-model',
  temperature: null,
  maxOutputTokens: null,
}

describe('ModelConnectionTester', () => {
  it('accepts an OpenAI-compatible streaming response', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('data: {"choices":[]}\n\n', {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      }),
    )
    const tester = new ModelConnectionTester(fetchMock)

    await expect(tester.test(settings, 'secret')).resolves.toEqual({
      outcome: 'success',
      message: '连接成功，端点接受流式文本和工具调用参数',
    })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.test/v1/chat/completions',
      expect.objectContaining({ method: 'POST' }),
    )
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
    expect((await tester.test(settings, 'secret')).outcome).toBe('incompatible')
  })

  it('classifies transport failures as connectivity errors', async () => {
    const tester = new ModelConnectionTester(
      vi.fn<typeof fetch>().mockRejectedValue(new TypeError('network failure')),
    )
    expect((await tester.test(settings, 'secret')).outcome).toBe('connectivity')
  })
})
