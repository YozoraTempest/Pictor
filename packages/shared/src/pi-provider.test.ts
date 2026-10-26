import { describe, expect, it } from 'vitest'

import type { ProviderView } from './model.js'
import { piProviderName, piProviderPlan, piProvidersOf, piThinkingLevelMap } from './pi-provider.js'

function provider(overrides: Partial<ProviderView> = {}): ProviderView {
  return {
    id: 'p1',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    protocol: 'openai-completions',
    modelId: 'deepseek-chat',
    models: [
      {
        id: 'deepseek-chat',
        name: 'DeepSeek Chat',
        reasoning: true,
        efforts: ['low', 'high'],
        defaultEffort: 'high',
        input: ['text'],
        contextWindow: 64_000,
        maxTokens: 8_000,
      },
    ],
    hasApiKey: true,
    ...overrides,
  }
}

describe('piProviderName', () => {
  it('prefixed and slugged, so it cannot collide with a provider Pi already has', () => {
    expect(piProviderName({ id: 'p1', name: 'DeepSeek' })).toBe('pictor-deepseek')
    expect(piProviderName({ id: 'p1', name: 'CC Switch（副本）' })).toBe('pictor-cc-switch')
  })

  it('falls back to the id when the name has nothing slug-able', () => {
    // A name made only of CJK has no ascii to slug; the id still identifies it.
    expect(piProviderName({ id: 'a1b2c3d4', name: '服务' })).toBe('pictor-a1b2c3d4')
  })
})

describe('piThinkingLevelMap', () => {
  it('maps each accepted level to itself and the rest to null', () => {
    // `null` means "this model does not take that level"; leaving the map out would
    // claim the opposite, that Pictor simply never asked.
    expect(piThinkingLevelMap(['low', 'high'])).toEqual({
      minimal: null,
      low: 'low',
      medium: null,
      high: 'high',
      xhigh: null,
      max: null,
    })
  })

  it('leaves the map out when the levels were never declared', () => {
    // Pi's own default is a better answer than a map invented here.
    expect(piThinkingLevelMap(null)).toBeUndefined()
  })
})

describe('piProviderPlan', () => {
  it('says a complete service is usable, and under what name', () => {
    expect(piProviderPlan(provider())).toEqual({
      ok: true,
      name: 'pictor-deepseek',
      models: 1,
    })
  })

  it('says why an incomplete one is not', () => {
    expect(piProviderPlan(provider({ hasApiKey: false }))).toEqual({
      ok: false,
      reason: '还没有密钥',
    })
    expect(piProviderPlan(provider({ models: [] }))).toEqual({ ok: false, reason: '还没有模型' })
    expect(piProviderPlan(provider({ baseUrl: ' ' }))).toEqual({ ok: false, reason: '还没有地址' })
  })
})

describe('piProvidersOf', () => {
  it('hands over the key, the endpoint and each model’s own facts', () => {
    const { providers, skipped } = piProvidersOf([provider()], () => 'sk-test')

    expect(skipped).toEqual([])
    expect(providers[0]).toMatchObject({
      name: 'pictor-deepseek',
      apiKey: 'sk-test',
      baseUrl: 'https://api.deepseek.com',
    })
    expect(providers[0]?.models[0]).toMatchObject({
      id: 'deepseek-chat',
      name: 'DeepSeek Chat',
      api: 'openai-completions',
      input: ['text'],
      contextWindow: 64_000,
      maxTokens: 8_000,
      thinkingLevelMap: expect.objectContaining({ low: 'low', high: 'high', max: null }),
    })
  })

  it('claims text only when the model never declared its input', () => {
    // Claiming images for a model that cannot see them sends one and fails upstream.
    const bare = provider({
      models: [
        {
          id: 'm',
          name: null,
          reasoning: null,
          efforts: null,
          defaultEffort: null,
          input: null,
          contextWindow: null,
          maxTokens: null,
        },
      ],
    })

    const spec = piProvidersOf([bare], () => 'k').providers[0]?.models[0]
    expect(spec?.input).toEqual(['text'])
    expect(spec).not.toHaveProperty('contextWindow')
    expect(spec).not.toHaveProperty('thinkingLevelMap')
  })

  it('skips a service without a key, and says so', () => {
    const { providers, skipped } = piProvidersOf([provider()], () => null)

    expect(providers).toEqual([])
    expect(skipped).toEqual([{ providerId: 'p1', name: 'DeepSeek', reason: '还没有密钥' }])
  })

  it('puts the service and model Pictor is using first, so a fresh Pi run starts there', () => {
    // Pi starts on the first model it knows; that default should be the same model dsh
    // uses, not whichever service was registered first.
    const first = provider({ id: 'a', name: 'First' })
    const second = provider({
      id: 'b',
      name: 'Second',
      modelId: 'm2',
      models: [
        { ...first.models[0]!, id: 'm1' },
        { ...first.models[0]!, id: 'm2' },
      ],
    })

    const { providers } = piProvidersOf([first, second], () => 'k', {
      providerId: 'b',
      modelId: 'm2',
    })

    expect(providers.map((spec) => spec.name)).toEqual(['pictor-second', 'pictor-first'])
    expect(providers[0]?.models.map((model) => model.id)).toEqual(['m2', 'm1'])
  })

  it('keeps two same-named services apart instead of letting one replace the other', () => {
    const { providers } = piProvidersOf(
      [provider({ id: 'a' }), provider({ id: 'b' })],
      (id) => `key-${id}`,
    )

    expect(providers.map((spec) => spec.name)).toEqual(['pictor-deepseek', 'pictor-deepseek-2'])
  })
})
