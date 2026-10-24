import { describe, expect, it } from 'vitest'

import type { ModelEntry } from '@pictor/shared'

import { capabilitiesOf, mergeModels, withCapabilities } from './models.js'

function entry(overrides: Partial<ModelEntry> & Pick<ModelEntry, 'id'>): ModelEntry {
  return {
    name: null,
    reasoning: null,
    input: null,
    contextWindow: null,
    maxTokens: null,
    ...overrides,
  }
}

describe('capabilitiesOf', () => {
  it('reads the modality list and the reasoning flag', () => {
    const model = entry({ id: 'm', input: ['text', 'image'], reasoning: true, maxTokens: 8000 })

    expect(capabilitiesOf(model)).toEqual({
      image: true,
      reasoning: true,
      contextWindow: null,
      maxTokens: 8000,
    })
  })

  it('treats an unknown model as text-only', () => {
    expect(capabilitiesOf(undefined)).toEqual({
      image: false,
      reasoning: false,
      contextWindow: null,
      maxTokens: null,
    })
  })
})

describe('withCapabilities', () => {
  it('declares image input on an existing model', () => {
    const models = withCapabilities([entry({ id: 'm', input: ['text'] })], 'm', { image: true })

    expect(models[0]?.input).toEqual(['text', 'image'])
  })

  it('creates the entry when only an id was typed', () => {
    const models = withCapabilities([], 'fresh', { image: true, contextWindow: 1000 })

    expect(models).toEqual([
      {
        id: 'fresh',
        name: null,
        reasoning: null,
        input: ['text', 'image'],
        contextWindow: 1000,
        maxTokens: null,
      },
    ])
  })

  it('leaves the modality list alone when only a limit changed', () => {
    const models = withCapabilities([entry({ id: 'm', input: null })], 'm', { maxTokens: 4096 })

    expect(models[0]).toMatchObject({ input: null, maxTokens: 4096 })
  })

  it('turns image input off explicitly', () => {
    const models = withCapabilities([entry({ id: 'm', input: ['text', 'image'] })], 'm', {
      image: false,
    })

    expect(models[0]?.input).toEqual(['text'])
  })

  it('does not touch other models', () => {
    const models = withCapabilities([entry({ id: 'a', maxTokens: 10 }), entry({ id: 'b' })], 'b', {
      reasoning: true,
    })

    expect(models[0]?.maxTokens).toBe(10)
    expect(models[1]?.reasoning).toBe(true)
  })
})

describe('mergeModels', () => {
  it('keeps the capabilities someone typed when the listing is refreshed', () => {
    const existing = [entry({ id: 'm', input: ['text', 'image'], contextWindow: 100_000 })]
    const fetched = [entry({ id: 'm', name: 'Model M' })]

    expect(mergeModels(existing, fetched)).toEqual([
      {
        id: 'm',
        name: 'Model M',
        reasoning: null,
        input: ['text', 'image'],
        contextWindow: 100_000,
        maxTokens: null,
      },
    ])
  })

  it('takes the endpoint word for a model it described', () => {
    const existing = [entry({ id: 'm' })]
    const fetched = [entry({ id: 'm', input: ['text', 'image'], maxTokens: 4096 })]

    expect(mergeModels(existing, fetched)[0]).toMatchObject({
      input: ['text', 'image'],
      maxTokens: 4096,
    })
  })

  it('drops models the endpoint no longer lists', () => {
    const merged = mergeModels(
      [entry({ id: 'gone' }), entry({ id: 'kept' })],
      [entry({ id: 'kept' })],
    )

    expect(merged.map((model) => model.id)).toEqual(['kept'])
  })

  it('adds a model the app had never seen', () => {
    expect(mergeModels([], [entry({ id: 'new' })]).map((model) => model.id)).toEqual(['new'])
  })
})
