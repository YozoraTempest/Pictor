import type {
  JsonValue,
  ModelEntry,
  ModelProtocol,
  ModelSettings,
  ModelSettingsInput,
  SettingsMap,
} from '@pictor/shared'

import { clearApiKey, readApiKey, writeApiKey } from './auth.js'

/** Provider id written into Pi's `models.json`. */
export const PROVIDER_ID = 'pictor'

export const SETTING_KEYS = {
  providerName: 'pi.providerName',
  baseUrl: 'pi.baseUrl',
  protocol: 'pi.protocol',
  modelId: 'pi.modelId',
  models: 'pi.models',
} as const

export interface SettingsStore {
  listSettings(): Promise<SettingsMap>
  putSetting(key: string, value: JsonValue): Promise<void>
}

export const EMPTY_MODEL_SETTINGS: ModelSettings = {
  providerName: '',
  baseUrl: '',
  protocol: 'chat-completions',
  modelId: '',
  models: [],
  hasApiKey: false,
}

export function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, '')
}

export function parseProtocol(value: JsonValue | undefined): ModelProtocol {
  return value === 'responses' ? 'responses' : 'chat-completions'
}

export function parseModels(value: JsonValue | undefined): ModelEntry[] {
  if (!Array.isArray(value)) return []

  const models: ModelEntry[] = []
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) continue

    const record = entry as Record<string, unknown>
    if (typeof record.id !== 'string' || record.id.trim().length === 0) continue

    models.push({
      id: record.id.trim(),
      name: typeof record.name === 'string' ? record.name : null,
      reasoning: typeof record.reasoning === 'boolean' ? record.reasoning : null,
      input: Array.isArray(record.input)
        ? record.input.filter((item): item is string => typeof item === 'string')
        : null,
      contextWindow: typeof record.contextWindow === 'number' ? record.contextWindow : null,
      maxTokens: typeof record.maxTokens === 'number' ? record.maxTokens : null,
    })
  }

  return models
}

export async function readModelSettings(
  store: SettingsStore,
  authPath: string,
): Promise<ModelSettings> {
  const settings = await store.listSettings()

  return {
    providerName:
      typeof settings[SETTING_KEYS.providerName] === 'string'
        ? (settings[SETTING_KEYS.providerName] as string)
        : '',
    baseUrl:
      typeof settings[SETTING_KEYS.baseUrl] === 'string'
        ? (settings[SETTING_KEYS.baseUrl] as string)
        : '',
    protocol: parseProtocol(settings[SETTING_KEYS.protocol]),
    modelId:
      typeof settings[SETTING_KEYS.modelId] === 'string'
        ? (settings[SETTING_KEYS.modelId] as string)
        : '',
    models: parseModels(settings[SETTING_KEYS.models]),
    hasApiKey: readApiKey(authPath, PROVIDER_ID) !== null,
  }
}

export async function saveModelSettings(
  store: SettingsStore,
  authPath: string,
  input: ModelSettingsInput,
): Promise<ModelSettings> {
  const baseUrl = normalizeBaseUrl(input.baseUrl)
  if (baseUrl.length === 0) {
    throw new Error('Base URL is required')
  }
  if (!/^https?:\/\//i.test(baseUrl)) {
    throw new Error('Base URL must start with http:// or https://')
  }
  if (input.modelId.trim().length === 0) {
    throw new Error('Model id is required')
  }

  await store.putSetting(SETTING_KEYS.providerName, input.providerName.trim())
  await store.putSetting(SETTING_KEYS.baseUrl, baseUrl)
  await store.putSetting(SETTING_KEYS.protocol, input.protocol)
  await store.putSetting(SETTING_KEYS.modelId, input.modelId.trim())
  await store.putSetting(SETTING_KEYS.models, input.models as unknown as JsonValue)

  if (input.apiKey !== undefined) {
    if (input.apiKey.trim().length === 0) {
      clearApiKey(authPath, PROVIDER_ID)
    } else {
      writeApiKey(authPath, PROVIDER_ID, input.apiKey.trim())
    }
  }

  return readModelSettings(store, authPath)
}
