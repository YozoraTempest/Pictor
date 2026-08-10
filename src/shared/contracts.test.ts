import { describe, expect, it } from 'vitest'

import { modelSettingsInputSchema } from './contracts.js'

describe('modelSettingsInputSchema', () => {
  it.each(['https://api.example.test/v1', 'http://localhost:1234/v1', 'http://127.0.0.1/v1'])(
    'accepts secure remote or loopback URL %s',
    (baseUrl) => {
      expect(
        modelSettingsInputSchema.safeParse({
          baseUrl,
          modelId: 'model-1',
          temperature: null,
          maxOutputTokens: null,
        }).success,
      ).toBe(true)
    },
  )

  it('rejects plaintext HTTP for remote hosts', () => {
    const result = modelSettingsInputSchema.safeParse({
      baseUrl: 'http://api.example.test/v1',
      modelId: 'model-1',
      temperature: null,
      maxOutputTokens: null,
    })
    expect(result.success).toBe(false)
  })
})
