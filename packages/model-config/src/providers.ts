import type {
  JsonValue,
  ModelEntry,
  ModelProtocol,
  ModelProvider,
  ProviderInput,
  ProviderList,
  ProviderView,
} from '@pictor/shared'

import { clearApiKey, readApiKey, writeApiKey } from './auth.js'

export type { ModelProvider, ProviderInput, ProviderList, ProviderView }

/** Where the provider list and the active choice are stored. */
export const PROVIDERS_KEY = 'pi.providers'
export const ACTIVE_PROVIDER_KEY = 'pi.activeProvider'

/**
 * Keys used by the single-provider layout.
 *
 * They are still read once, so an install created before the list existed keeps
 * working: its configuration becomes the first provider, under the id its API
 * key was already filed with.
 */
export const LEGACY_KEYS = {
  name: 'pi.providerName',
  baseUrl: 'pi.baseUrl',
  protocol: 'pi.protocol',
  modelId: 'pi.modelId',
  models: 'pi.models',
} as const

/** Id the legacy layout filed its key under, and the first provider reuses. */
export const LEGACY_PROVIDER_ID = 'pictor'

export interface SettingsStore {
  listSettings(): Promise<Record<string, JsonValue>>
  putSetting(key: string, value: JsonValue): Promise<void>
}

export const EMPTY_PROVIDER_LIST: ProviderList = { providers: [], activeId: null }

export function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, '')
}

/**
 * Reads a stored protocol.
 *
 * The two short names are what earlier versions wrote, so they stay readable
 * forever: a profile saved before the runtime vocabulary arrived keeps working
 * instead of silently falling back to the default.
 */
function parseProtocol(value: unknown): ModelProtocol {
  if (value === 'openai-responses' || value === 'responses') return 'openai-responses'
  if (value === 'anthropic-messages') return 'anthropic-messages'
  return 'openai-completions'
}

/** Drops anything that is not a usable model entry rather than trusting the store. */
export function parseModels(value: unknown): ModelEntry[] {
  if (!Array.isArray(value)) return []

  return value.flatMap((entry): ModelEntry[] => {
    if (typeof entry !== 'object' || entry === null) return []
    const record = entry as Record<string, unknown>
    const id = record['id']
    if (typeof id !== 'string' || id.length === 0) return []

    const name = record['name']
    const reasoning = record['reasoning']
    const input = record['input']
    const contextWindow = record['contextWindow']
    const maxTokens = record['maxTokens']

    return [
      {
        id,
        name: typeof name === 'string' && name.length > 0 ? name : null,
        reasoning: typeof reasoning === 'boolean' ? reasoning : null,
        input:
          Array.isArray(input) && input.every((entry) => typeof entry === 'string')
            ? (input as string[])
            : null,
        contextWindow: typeof contextWindow === 'number' ? contextWindow : null,
        maxTokens: typeof maxTokens === 'number' ? maxTokens : null,
      },
    ]
  })
}

function parseProvider(value: unknown): ModelProvider | null {
  if (typeof value !== 'object' || value === null) return null
  const record = value as Record<string, unknown>

  const id = record['id']
  const baseUrl = record['baseUrl']
  if (typeof id !== 'string' || id.length === 0) return null
  if (typeof baseUrl !== 'string') return null

  const name = record['name']
  const modelId = record['modelId']

  return {
    id,
    name: typeof name === 'string' ? name : '',
    baseUrl,
    protocol: parseProtocol(record['protocol']),
    modelId: typeof modelId === 'string' ? modelId : '',
    models: parseModels(record['models']),
  }
}

/** The provider a fresh install starts from, built out of the legacy keys. */
function legacyProvider(settings: Record<string, JsonValue>): ModelProvider | null {
  const baseUrl = settings[LEGACY_KEYS.baseUrl]
  if (typeof baseUrl !== 'string' || baseUrl.length === 0) return null

  const name = settings[LEGACY_KEYS.name]
  const modelId = settings[LEGACY_KEYS.modelId]

  return {
    id: LEGACY_PROVIDER_ID,
    name: typeof name === 'string' ? name : '',
    baseUrl,
    protocol: parseProtocol(settings[LEGACY_KEYS.protocol]),
    modelId: typeof modelId === 'string' ? modelId : '',
    models: parseModels(settings[LEGACY_KEYS.models]),
  }
}

/**
 * The stored list, or `null` when the key was never written.
 *
 * The difference matters: an empty array means the user removed every provider,
 * while a missing key means this profile still uses the single-provider layout.
 * Treating both as "empty" made the last provider reappear from the legacy keys
 * the moment it was deleted.
 */
function readStored(settings: Record<string, JsonValue>): ModelProvider[] | null {
  const value = settings[PROVIDERS_KEY]
  if (!Array.isArray(value)) return null

  return value.flatMap((entry): ModelProvider[] => {
    const provider = parseProvider(entry)
    return provider === null ? [] : [provider]
  })
}

/**
 * The provider list, migrating the single-provider layout on first read.
 *
 * The migration is derived rather than written: nothing is persisted until the
 * user saves, so a read can never rewrite settings behind the page's back.
 */
export async function readProviders(store: SettingsStore, authPath: string): Promise<ProviderList> {
  const settings = await store.listSettings()
  const stored = readStored(settings)
  // `null` means the key was never written, so this profile still uses the
  // single-provider layout and derives its first provider. An empty array is a
  // decision the user made by removing every provider, and must stay empty.
  const providers =
    stored ??
    [legacyProvider(settings)].filter((provider): provider is ModelProvider => provider !== null)
  if (providers.length === 0) return EMPTY_PROVIDER_LIST

  const storedActive = settings[ACTIVE_PROVIDER_KEY]
  const activeId =
    typeof storedActive === 'string' && providers.some((provider) => provider.id === storedActive)
      ? storedActive
      : (providers[0]?.id ?? null)

  return {
    providers: providers.map((provider) => ({
      ...provider,
      hasApiKey: readApiKey(authPath, provider.id) !== null,
    })),
    activeId,
  }
}

function validate(input: ProviderInput): { name: string; baseUrl: string; modelId: string } {
  const baseUrl = normalizeBaseUrl(input.baseUrl)
  if (baseUrl.length === 0) throw new Error('Base URL is required')
  if (!/^https?:\/\//i.test(baseUrl))
    throw new Error('Base URL must start with http:// or https://')

  return {
    name: input.name.trim(),
    baseUrl,
    modelId: input.modelId.trim(),
  }
}

function writeProvider(provider: ModelProvider): JsonValue {
  return {
    id: provider.id,
    name: provider.name,
    baseUrl: provider.baseUrl,
    protocol: provider.protocol,
    modelId: provider.modelId,
    models: provider.models as unknown as JsonValue,
  }
}

async function writeProviders(
  store: SettingsStore,
  providers: ModelProvider[],
  activeId: string | null,
): Promise<void> {
  await store.putSetting(PROVIDERS_KEY, providers.map(writeProvider))
  // Written even when null: a stale active id would survive deleting the last
  // provider and make it look alive again on the next read.
  await store.putSetting(ACTIVE_PROVIDER_KEY, activeId)
}

/** Adds a provider, or updates the one `input.id` names. */
export async function saveProvider(
  store: SettingsStore,
  authPath: string,
  input: ProviderInput,
): Promise<ProviderList> {
  const { name, baseUrl, modelId } = validate(input)
  const current = await readProviders(store, authPath)

  const existing =
    input.id === undefined
      ? undefined
      : current.providers.find((provider) => provider.id === input.id)

  // A profile created before the list existed filed its key under the legacy id.
  // Only the *first* provider may adopt it: reusing it once a list exists would
  // hand two providers the same id, and the active one would match both rows.
  const adoptsLegacyId =
    current.providers.length === 0 && readApiKey(authPath, LEGACY_PROVIDER_ID) !== null
  const idForNew = adoptsLegacyId ? LEGACY_PROVIDER_ID : crypto.randomUUID()

  const provider: ModelProvider = {
    id: existing?.id ?? idForNew,
    name,
    baseUrl,
    protocol: input.protocol,
    modelId,
    models: input.models,
  }

  const providers =
    existing === undefined
      ? [...current.providers.map(stripKey), provider]
      : current.providers.map((entry) => (entry.id === provider.id ? provider : stripKey(entry)))

  if (input.apiKey !== undefined) {
    if (input.apiKey.trim().length === 0) clearApiKey(authPath, provider.id)
    else writeApiKey(authPath, provider.id, input.apiKey.trim())
  }

  // The first provider added becomes active; otherwise the choice stands.
  const activeId = current.activeId ?? provider.id
  await writeProviders(store, providers, activeId)

  return readProviders(store, authPath)
}

function stripKey(provider: ProviderView): ModelProvider {
  return {
    id: provider.id,
    name: provider.name,
    baseUrl: provider.baseUrl,
    protocol: provider.protocol,
    modelId: provider.modelId,
    models: provider.models,
  }
}

/** Removes a provider and its key, moving the active choice if it pointed here. */
export async function removeProvider(
  store: SettingsStore,
  authPath: string,
  id: string,
): Promise<ProviderList> {
  const current = await readProviders(store, authPath)
  const providers = current.providers.filter((provider) => provider.id !== id).map(stripKey)

  clearApiKey(authPath, id)

  const activeId = current.activeId === id ? (providers[0]?.id ?? null) : current.activeId

  await writeProviders(store, providers, activeId)
  return readProviders(store, authPath)
}

/** Chooses the provider conversations use. */
export async function activateProvider(
  store: SettingsStore,
  authPath: string,
  id: string,
): Promise<ProviderList> {
  const current = await readProviders(store, authPath)
  if (!current.providers.some((provider) => provider.id === id)) {
    throw new Error(`unknown provider: ${id}`)
  }

  await writeProviders(store, current.providers.map(stripKey), id)
  return readProviders(store, authPath)
}

/** Records the model a provider should use, after the picker changes it. */
export async function setProviderModel(
  store: SettingsStore,
  authPath: string,
  id: string,
  modelId: string,
): Promise<ProviderList> {
  const trimmed = modelId.trim()
  if (trimmed.length === 0) throw new Error('Model id is required')

  const current = await readProviders(store, authPath)
  const target = current.providers.find((provider) => provider.id === id)
  if (target === undefined) throw new Error(`unknown provider: ${id}`)
  if (target.models.length > 0 && !target.models.some((model) => model.id === trimmed)) {
    throw new Error(`unknown model: ${trimmed}`)
  }

  const providers = current.providers.map((provider) =>
    provider.id === id ? { ...stripKey(provider), modelId: trimmed } : stripKey(provider),
  )

  await writeProviders(store, providers, current.activeId)
  return readProviders(store, authPath)
}
