import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import type { JsonValue, SettingsMap } from '@vulonlok/shared'

import { readApiKey, writeApiKey } from './auth.js'
import {
  LEGACY_KEYS,
  LEGACY_PROVIDER_ID,
  PROVIDERS_KEY,
  activateProvider,
  readProviders,
  removeProvider,
  saveProvider,
  setProviderModel,
  type SettingsStore,
} from './providers.js'

class MemorySettings implements SettingsStore {
  readonly values: SettingsMap = {}

  async listSettings(): Promise<SettingsMap> {
    return { ...this.values }
  }

  async putSetting(key: string, value: JsonValue): Promise<void> {
    this.values[key] = value
  }
}

function authPath(): string {
  return join(mkdtempSync(join(tmpdir(), 'pictor-providers-')), 'auth.json')
}

function input(
  overrides: Partial<Parameters<typeof saveProvider>[2]> = {},
): Parameters<typeof saveProvider>[2] {
  return {
    name: 'Neko',
    baseUrl: 'https://api.example.com',
    protocol: 'openai-completions',
    modelId: 'demo',
    models: [],
    ...overrides,
  }
}

describe('provider list', () => {
  it('starts empty', async () => {
    const list = await readProviders(new MemorySettings(), authPath())

    expect(list.providers).toEqual([])
    expect(list.activeId).toBeNull()
  })

  it('migrates the single-provider layout without writing', async () => {
    const store = new MemorySettings()
    store.values[LEGACY_KEYS.name] = 'Old'
    store.values[LEGACY_KEYS.baseUrl] = 'https://old.example.com'
    store.values[LEGACY_KEYS.modelId] = 'old-model'

    const list = await readProviders(store, authPath())

    expect(list.providers).toHaveLength(1)
    expect(list.providers[0]?.id).toBe(LEGACY_PROVIDER_ID)
    expect(list.providers[0]?.name).toBe('Old')
    expect(list.activeId).toBe(LEGACY_PROVIDER_ID)
    // Derived, not persisted: a read must not rewrite settings.
    expect(store.values['pi.providers']).toBeUndefined()
  })

  it('adds providers and activates the first one', async () => {
    const store = new MemorySettings()
    const path = authPath()

    const first = await saveProvider(store, path, input({ name: 'A' }))
    expect(first.providers).toHaveLength(1)
    expect(first.activeId).toBe(first.providers[0]?.id)

    const second = await saveProvider(store, path, input({ name: 'B', apiKey: 'key-b' }))
    expect(second.providers.map((provider) => provider.name)).toEqual(['A', 'B'])
    // Adding does not steal the active choice.
    expect(second.activeId).toBe(first.activeId)
  })

  it('keeps the legacy key attached to the first provider', async () => {
    const store = new MemorySettings()
    const path = authPath()
    writeApiKey(path, LEGACY_PROVIDER_ID, 'legacy-key')

    const list = await saveProvider(store, path, input())

    expect(list.providers[0]?.id).toBe(LEGACY_PROVIDER_ID)
    expect(list.providers[0]?.hasApiKey).toBe(true)
  })

  it('gives every provider its own id, even with a legacy key around', async () => {
    const store = new MemorySettings()
    const path = authPath()
    // The legacy key must only ever be adopted by the very first provider.
    writeApiKey(path, LEGACY_PROVIDER_ID, 'legacy-key')

    const first = await saveProvider(store, path, input({ name: 'A' }))
    const second = await saveProvider(store, path, input({ name: 'B' }))

    const ids = second.providers.map((provider) => provider.id)
    expect(new Set(ids).size).toBe(2)
    expect(ids[0]).toBe(LEGACY_PROVIDER_ID)
    // A single active id cannot match two rows.
    expect(second.providers.filter((provider) => provider.id === second.activeId)).toHaveLength(1)
    expect(first.providers).toHaveLength(1)
  })

  it('switches the active provider and rejects unknown ids', async () => {
    const store = new MemorySettings()
    const path = authPath()

    const added = await saveProvider(store, path, input({ name: 'A' }))
    const firstId = added.providers[0]?.id ?? ''
    const another = await saveProvider(store, path, input({ name: 'B' }))

    const switched = await activateProvider(store, path, another.providers[1]?.id ?? '')
    expect(switched.activeId).toBe(another.providers[1]?.id)

    await expect(activateProvider(store, path, 'nope')).rejects.toThrow(/unknown provider/)
    expect(firstId.length).toBeGreaterThan(0)
  })

  it('removes a provider, its key, and hands the active slot on', async () => {
    const store = new MemorySettings()
    const path = authPath()

    await saveProvider(store, path, input({ name: 'A', apiKey: 'key-a' }))
    const list = await saveProvider(store, path, input({ name: 'B', apiKey: 'key-b' }))
    const [a, b] = list.providers

    const after = await removeProvider(store, path, a?.id ?? '')

    expect(after.providers.map((provider) => provider.name)).toEqual(['B'])
    expect(after.activeId).toBe(b?.id)
    expect(readApiKey(path, a?.id ?? '')).toBeNull()
    expect(readApiKey(path, b?.id ?? '')).toBe('key-b')
  })

  it('stays empty after the last provider is removed, even with legacy keys', async () => {
    const store = new MemorySettings()
    const path = authPath()

    // A profile that predates the list still carries the single-provider keys,
    // and the user has since removed every provider.
    store.values[LEGACY_KEYS.name] = 'Old'
    store.values[LEGACY_KEYS.baseUrl] = 'https://legacy.example.com'
    store.values[LEGACY_KEYS.modelId] = 'legacy-model'
    store.values[PROVIDERS_KEY] = []

    // Empty means the user removed everything; a missing key means "never
    // migrated". Conflating them resurrected the provider from the legacy keys.
    expect((await readProviders(store, path)).providers).toEqual([])

    const list = await saveProvider(store, path, input({ name: 'Only', apiKey: 'key' }))
    expect(list.providers).toHaveLength(1)

    const after = await removeProvider(store, path, list.activeId ?? '')
    expect(after.providers).toEqual([])
    expect(after.activeId).toBeNull()
    expect((await readProviders(store, path)).providers).toEqual([])
  })

  it('records the model of a provider, refusing ids it never reported', async () => {
    const store = new MemorySettings()
    const path = authPath()

    const list = await saveProvider(
      store,
      path,
      input({
        models: [
          {
            id: 'known',
            name: null,
            reasoning: null,
            efforts: null,
            defaultEffort: null,
            input: null,
            contextWindow: null,
            maxTokens: null,
          },
        ],
      }),
    )
    const id = list.providers[0]?.id ?? ''

    const updated = await setProviderModel(store, path, id, 'known')
    expect(updated.providers[0]?.modelId).toBe('known')

    await expect(setProviderModel(store, path, id, 'unknown')).rejects.toThrow(/unknown model/)
  })

  it('leaves the stored key alone when an update omits it', async () => {
    const store = new MemorySettings()
    const path = authPath()

    const list = await saveProvider(store, path, input({ apiKey: 'secret' }))
    const id = list.providers[0]?.id ?? ''

    const updated = await saveProvider(store, path, { ...input({ name: 'Renamed' }), id })

    expect(updated.providers[0]?.name).toBe('Renamed')
    expect(updated.providers[0]?.hasApiKey).toBe(true)
    expect(readApiKey(path, id)).toBe('secret')
  })
  it('reads the short protocol names earlier versions wrote', async () => {
    const store = new MemorySettings()
    store.values[PROVIDERS_KEY] = [
      { id: 'a', name: 'A', baseUrl: 'https://a.example.com', protocol: 'chat-completions' },
      { id: 'b', name: 'B', baseUrl: 'https://b.example.com', protocol: 'responses' },
      { id: 'c', name: 'C', baseUrl: 'https://c.example.com', protocol: 'anthropic-messages' },
    ]

    const list = await readProviders(store, authPath())

    expect(list.providers.map((provider) => provider.protocol)).toEqual([
      'openai-completions',
      'openai-responses',
      'anthropic-messages',
    ])
  })
})
