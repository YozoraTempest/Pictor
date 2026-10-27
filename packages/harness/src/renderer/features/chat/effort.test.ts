import { describe, expect, it } from 'vitest'

import type { ModelEffort, ModelEntry } from '@vulonlok/shared'

import { designedEffort, effortsOf, pickEffort } from './effort.js'

function model(overrides: Partial<ModelEntry> & Pick<ModelEntry, 'id'>): ModelEntry {
  return {
    name: null,
    reasoning: null,
    efforts: null,
    defaultEffort: null,
    input: null,
    contextWindow: null,
    maxTokens: null,
    ...overrides,
  }
}

describe('effortsOf', () => {
  it('reads the levels the model declared', () => {
    const levels: ModelEffort[] = ['low', 'high']

    expect(effortsOf(model({ id: 'm', efforts: levels }))).toEqual(levels)
  })

  it('gives a model that reasons but names no levels the standard three', () => {
    expect(effortsOf(model({ id: 'm', reasoning: true }))).toEqual(['low', 'medium', 'high'])
  })

  it('offers nothing for a model that declared none', () => {
    expect(effortsOf(model({ id: 'm' }))).toEqual([])
    expect(effortsOf(undefined)).toEqual([])
  })
})

describe('designedEffort', () => {
  it('reads the level the model was set up with', () => {
    expect(
      designedEffort(model({ id: 'm', efforts: ['low', 'high'], defaultEffort: 'high' })),
    ).toBe('high')
  })

  it('treats a model without a designed level as omit', () => {
    expect(designedEffort(model({ id: 'm', efforts: ['low'] }))).toBeNull()
    expect(designedEffort(undefined)).toBeNull()
  })

  it('ignores a designed level the model no longer offers', () => {
    // Sending it would be refused, and the picker could not show it either.
    expect(designedEffort(model({ id: 'm', efforts: ['low'], defaultEffort: 'high' }))).toBeNull()
  })
})

describe('pickEffort', () => {
  it('keeps a chosen level the model still offers', () => {
    expect(pickEffort(['low', 'high'], 'high')).toBe('high')
  })

  it('drops a chosen level the model does not offer', () => {
    // Sending it anyway would fail the turn; keeping it would claim a level the
    // picker cannot honour.
    expect(pickEffort(['low', 'medium'], 'high')).toBeNull()
  })

  it('treats no chosen level as omit', () => {
    expect(pickEffort(['low'], null)).toBeNull()
  })
})
