import { mkdtempSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import type { JsonValue, ModelSettings, SettingsMap } from '@vulonlok/shared'

import { readApiKey, writeApiKey } from './auth.js'
import { normalizeBaseUrl, parseModels, type SettingsStore } from './providers.js'
import { readProviders, saveProvider } from './providers.js'
import { readModelSettings, saveModelSettings, useModel } from './settings.js'

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
  return join(mkdtempSync(join(tmpdir(), 'pictor-auth-')), 'auth.json')
}

const settings: ModelSettings = {
  providerId: 'pictor',
  providerName: 'Neko',
  baseUrl: 'https://api.example.com',
  protocol: 'openai-completions',
  modelId: 'demo',
  models: [
    {
      id: 'demo',
      name: 'Demo',
      reasoning: true,
      efforts: null,
      defaultEffort: null,
      input: ['text'],
      contextWindow: 1000,
      maxTokens: 200,
    },
  ],
  hasApiKey: true,
}

describe('useModel', () => {
  /** Two services, each with its own key, as a reader would configure them. */
  async function twoServices(): Promise<{ store: MemorySettings; path: string }> {
    const store = new MemorySettings()
    const path = authPath()
    await saveProvider(store, path, {
      name: 'A',
      baseUrl: 'https://a.example.com',
      protocol: 'openai-completions',
      modelId: 'a-model',
      models: [
        {
          id: 'a-model',
          name: null,
          reasoning: null,
          efforts: null,
          defaultEffort: null,
          input: null,
          contextWindow: null,
          maxTokens: null,
        },
        {
          id: 'a-small',
          name: null,
          reasoning: null,
          efforts: null,
          defaultEffort: null,
          input: null,
          contextWindow: null,
          maxTokens: null,
        },
      ],
      apiKey: 'key-a',
    })
    await saveProvider(store, path, {
      name: 'B',
      baseUrl: 'https://b.example.com',
      protocol: 'openai-completions',
      modelId: 'b-model',
      models: [
        {
          id: 'b-model',
          name: null,
          reasoning: null,
          efforts: null,
          defaultEffort: null,
          input: null,
          contextWindow: null,
          maxTokens: null,
        },
      ],
      apiKey: 'key-b',
    })
    return { store, path }
  }

  it('switches service and model in one write', async () => {
    const { store, path } = await twoServices()
    const before = await readProviders(store, path)
    const target = before.providers.find((provider) => provider.name === 'A')
    if (target === undefined) throw new Error('service A is missing')

    await useModel(store, path, target.id, 'a-small')

    const after = await readProviders(store, path)
    expect(after.activeId).toBe(target.id)
    expect(after.providers.find((provider) => provider.id === target.id)?.modelId).toBe('a-small')
    // The other service keeps its own model and its own key.
    expect(after.providers.find((provider) => provider.name === 'B')?.modelId).toBe('b-model')
    expect(readApiKey(path, target.id)).toBe('key-a')
  })

  it('refuses a model that belongs to another service', async () => {
    const { store, path } = await twoServices()
    const before = await readProviders(store, path)
    const a = before.providers.find((provider) => provider.name === 'A')

    await expect(useModel(store, path, a?.id ?? '', 'b-model')).rejects.toThrow(/unknown model/)
  })

  it('refuses an unknown service', async () => {
    const { store, path } = await twoServices()

    await expect(useModel(store, path, 'missing', 'a-model')).rejects.toThrow(/unknown provider/)
  })
})

describe('auth store', () => {
  it('writes and reads a key with 0600 permissions', () => {
    const path = authPath()
    writeApiKey(path, 'pictor', 'secret-key')

    expect(readApiKey(path, 'pictor')).toBe('secret-key')
    if (process.platform !== 'win32') {
      expect(statSync(path).mode & 0o777).toBe(0o600)
    }
  })

  it('treats malformed files as empty', () => {
    const path = authPath()
    writeApiKey(path, 'pictor', 'secret-key')
    expect(readApiKey(path, 'missing')).toBeNull()
  })
})

describe('settings', () => {
  it('trims trailing slashes from the base url', () => {
    expect(normalizeBaseUrl(' https://api.example.com/v1/// ')).toBe('https://api.example.com/v1')
  })

  it('parses only well-formed model entries', () => {
    expect(
      parseModels([
        { id: 'a', name: 'A' },
        { name: 'missing id' },
        'nope',
        { id: 'b', contextWindow: 100 },
      ]),
    ).toEqual([
      {
        id: 'a',
        name: 'A',
        reasoning: null,
        efforts: null,
        defaultEffort: null,
        input: null,
        contextWindow: null,
        maxTokens: null,
      },
      {
        id: 'b',
        name: null,
        reasoning: null,
        efforts: null,
        defaultEffort: null,
        input: null,
        contextWindow: 100,
        maxTokens: null,
      },
    ])
  })

  it('round-trips settings and keeps the key masked', async () => {
    const store = new MemorySettings()
    const path = authPath()

    const saved = await saveModelSettings(store, path, {
      providerName: 'Neko',
      baseUrl: 'https://api.example.com/',
      protocol: 'openai-responses',
      modelId: 'demo',
      models: settings.models,
      apiKey: 'secret-key',
    })

    expect(saved.baseUrl).toBe('https://api.example.com')
    expect(saved.protocol).toBe('openai-responses')
    expect(saved.hasApiKey).toBe(true)
    expect(JSON.stringify(saved)).not.toContain('secret-key')

    const reread = await readModelSettings(store, path)
    expect(reread).toEqual(saved)
  })

  it('clears the key when an empty string is sent', async () => {
    const store = new MemorySettings()
    const path = authPath()
    writeApiKey(path, 'pictor', 'secret-key')

    const saved = await saveModelSettings(store, path, {
      providerName: 'Neko',
      baseUrl: 'https://api.example.com',
      protocol: 'openai-completions',
      modelId: 'demo',
      models: [],
      apiKey: '',
    })

    expect(saved.hasApiKey).toBe(false)
  })

  it('keeps the stored key when apiKey is omitted', async () => {
    const store = new MemorySettings()
    const path = authPath()
    writeApiKey(path, 'pictor', 'secret-key')

    const saved = await saveModelSettings(store, path, {
      providerName: 'Neko',
      baseUrl: 'https://api.example.com',
      protocol: 'openai-completions',
      modelId: 'demo',
      models: [],
    })

    expect(saved.hasApiKey).toBe(true)
    expect(readApiKey(path, 'pictor')).toBe('secret-key')
  })

  it('rejects invalid input', async () => {
    const store = new MemorySettings()
    const path = authPath()

    await expect(
      saveModelSettings(store, path, {
        providerName: '',
        baseUrl: 'ftp://example.com',
        protocol: 'openai-completions',
        modelId: 'demo',
        models: [],
      }),
    ).rejects.toThrow(/http/)

    // An empty model id is allowed on purpose: a provider can be saved before a
    // model is picked, and the page marks it as not usable until one is.
    const saved = await saveModelSettings(store, path, {
      providerName: '',
      baseUrl: 'https://example.com',
      protocol: 'openai-completions',
      modelId: ' ',
      models: [],
    })
    expect(saved.modelId).toBe('')
  })
})
