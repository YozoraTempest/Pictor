import { describe, expect, it } from 'vitest'

import { modelSettingsInputSchema } from './model.js'

describe('modelSettingsInputSchema', () => {
  it.each(['https://api.example.test/v1', 'http://localhost:1234/v1', 'http://127.0.0.1/v1'])(
    'accepts secure remote or loopback URL %s',
    (baseUrl) => {
      const result = modelSettingsInputSchema.safeParse({
        baseUrl,
        modelId: 'model-1',
        reasoningEffort: null,
        temperature: null,
        maxOutputTokens: null,
      })
      expect(result.success).toBe(true)
      if (result.success) expect(result.data.apiProtocol).toBe('chat-completions')
    },
  )

  it.each(['chat-completions', 'responses'] as const)('accepts API protocol %s', (apiProtocol) => {
    expect(
      modelSettingsInputSchema.safeParse({
        apiProtocol,
        baseUrl: 'https://api.example.test/v1',
        modelId: 'model-1',
        reasoningEffort: 'high',
        temperature: null,
        maxOutputTokens: null,
      }).success,
    ).toBe(true)
  })

  it('rejects plaintext HTTP for remote hosts', () => {
    const result = modelSettingsInputSchema.safeParse({
      baseUrl: 'http://api.example.test/v1',
      modelId: 'model-1',
      reasoningEffort: null,
      temperature: null,
      maxOutputTokens: null,
    })
    expect(result.success).toBe(false)
  })

  it.each(['minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const)(
    'accepts reasoning effort %s',
    (reasoningEffort) => {
      expect(
        modelSettingsInputSchema.safeParse({
          baseUrl: 'https://api.example.test/v1',
          modelId: 'gpt-5.6-sol',
          reasoningEffort,
          temperature: null,
          maxOutputTokens: null,
        }).success,
      ).toBe(true)
    },
  )
})
