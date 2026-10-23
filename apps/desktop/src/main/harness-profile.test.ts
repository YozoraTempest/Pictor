import { describe, expect, it } from 'vitest'

import { buildProfilePatch, ROUTE, ROUTE_API_KEY_ENV } from './harness-profile.js'

type Entry = { id: string; disabled?: boolean; config?: Record<string, unknown> }

function entries(patch: string): Entry[] {
  return JSON.parse(patch) as Entry[]
}

function routeOf(patch: string): Record<string, unknown> {
  const entry = entries(patch).find((item) => item.id === 'llm-pi-ai')
  const providers = entry?.config?.['providers'] as Record<string, Record<string, unknown>>
  return providers[ROUTE] ?? {}
}

describe('buildProfilePatch', () => {
  const base = {
    protocol: 'openai-completions' as const,
    baseUrl: 'https://api.example.com/v1',
    modelId: 'demo',
    models: [
      {
        id: 'demo',
        name: 'Demo',
        reasoning: true,
        input: ['text'],
        contextWindow: 1000,
        maxTokens: 100,
      },
    ],
  }

  it('declares the selected protocol as the route api', () => {
    expect(routeOf(buildProfilePatch({ ...base, protocol: 'anthropic-messages' }))['api']).toBe(
      'anthropic-messages',
    )
    expect(routeOf(buildProfilePatch({ ...base, protocol: 'openai-responses' }))['api']).toBe(
      'openai-responses',
    )
  })

  it('points the default model at the route it just declared', () => {
    const entry = entries(buildProfilePatch(base)).find((item) => item.id === 'agent-default-model')
    expect(entry?.config).toEqual({ provider: ROUTE, model: 'demo' })
  })

  it('disables the route whose protocol cannot be configured', () => {
    const disabled = entries(buildProfilePatch(base)).filter((item) => item.disabled === true)
    expect(disabled.map((item) => item.id)).toEqual(['llm-deepseek', 'llm-deepseek-account'])
  })

  it('resolves the key through the environment instead of the file', () => {
    const patch = buildProfilePatch(base)
    expect(routeOf(patch)['apiKeyEnv']).toBe(ROUTE_API_KEY_ENV)
    expect(patch).not.toContain('sk-')
  })

  it('falls back to one model entry when the endpoint reported none', () => {
    expect(routeOf(buildProfilePatch({ ...base, models: [] }))['models']).toEqual([{ id: 'demo' }])
  })

  it('omits fields the endpoint did not describe', () => {
    const route = routeOf(
      buildProfilePatch({
        ...base,
        models: [
          {
            id: 'demo',
            name: null,
            reasoning: null,
            input: null,
            contextWindow: null,
            maxTokens: null,
          },
        ],
      }),
    )
    expect(route['models']).toEqual([{ id: 'demo' }])
  })

  it('keeps a base URL that looks like YAML intact', () => {
    // The file is YAML; JSON is a subset of it, so awkward values need no quoting
    // of their own.
    const url = 'https://gateway.example.com/v1?x=a:b#c'
    expect(routeOf(buildProfilePatch({ ...base, baseUrl: url }))['baseURL']).toBe(url)
    expect(() => entries(buildProfilePatch({ ...base, baseUrl: url }))).not.toThrow()
  })
})
