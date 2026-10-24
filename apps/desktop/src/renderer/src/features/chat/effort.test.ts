import { describe, expect, it } from 'vitest'

import type { ModelEffort, ModelEntry } from '@pictor/shared'

import { effortsOf, pickEffort } from './effort.js'

function model(overrides: Partial<ModelEntry> & Pick<ModelEntry, 'id'>): ModelEntry {
  return {
    name: null,
    reasoning: null,
    efforts: null,
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

  it('offers nothing for a model that declared none', () => {
    expect(effortsOf(model({ id: 'm' }))).toEqual([])
    expect(effortsOf(undefined)).toEqual([])
  })
})

describe('pickEffort', () => {
  it('keeps a saved level the model still offers', () => {
    expect(pickEffort(['low', 'high'], 'high')).toBe('high')
  })

  it('drops a saved level the model does not offer', () => {
    // Sending it anyway would fail the turn; keeping it would claim a level the
    // picker cannot honour.
    expect(pickEffort(['low', 'medium'], 'high')).toBeNull()
  })

  it('treats no saved level as the provider default', () => {
    expect(pickEffort(['low'], null)).toBeNull()
  })
})
