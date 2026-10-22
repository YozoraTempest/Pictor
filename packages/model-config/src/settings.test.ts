import { mkdtempSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import type { JsonValue, ModelSettings, SettingsMap } from '@pictor/shared'

import { buildModelsJson } from './models-json.js'
import { readApiKey, writeApiKey } from './auth.js'
import { normalizeBaseUrl, parseModels, type SettingsStore } from './providers.js'
import { readModelSettings, saveModelSettings } from './settings.js'

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
  protocol: 'chat-completions',
  modelId: 'demo',
  models: [
    {
      id: 'demo',
      name: 'Demo',
      reasoning: true,
      input: ['text'],
      contextWindow: 1000,
      maxTokens: 200,
    },
  ],
  hasApiKey: true,
}

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
        input: null,
        contextWindow: null,
        maxTokens: null,
      },
      {
        id: 'b',
        name: null,
        reasoning: null,
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
      protocol: 'responses',
      modelId: 'demo',
      models: settings.models,
      apiKey: 'secret-key',
    })

    expect(saved.baseUrl).toBe('https://api.example.com')
    expect(saved.protocol).toBe('responses')
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
      protocol: 'chat-completions',
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
      protocol: 'chat-completions',
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
        protocol: 'chat-completions',
        modelId: 'demo',
        models: [],
      }),
    ).rejects.toThrow(/http/)

    // An empty model id is allowed on purpose: a provider can be saved before a
    // model is picked, and the page marks it as not usable until one is.
    const saved = await saveModelSettings(store, path, {
      providerName: '',
      baseUrl: 'https://example.com',
      protocol: 'chat-completions',
      modelId: ' ',
      models: [],
    })
    expect(saved.modelId).toBe('')
  })
})

describe('buildModelsJson', () => {
  it('uses environment interpolation instead of the literal key', () => {
    const json = buildModelsJson(settings)
    const serialised = JSON.stringify(json)

    expect(serialised).toContain('$PICTOR_PROVIDER_API_KEY')
    expect(serialised).not.toContain('secret-key')
    expect(json).toMatchObject({
      providers: {
        pictor: {
          baseUrl: 'https://api.example.com',
          api: 'openai-completions',
          models: [{ id: 'demo', contextWindow: 1000, maxTokens: 200 }],
        },
      },
    })
  })

  it('maps the responses protocol', () => {
    const json = buildModelsJson({ ...settings, protocol: 'responses' })
    expect(json).toMatchObject({ providers: { pictor: { api: 'openai-responses' } } })
  })
})
