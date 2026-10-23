import type { ModelSettings, ModelSettingsInput } from '@pictor/shared'

import {
  EMPTY_PROVIDER_LIST,
  readProviders,
  saveProvider,
  setProviderModel,
  type ProviderList,
  type SettingsStore,
} from './providers.js'

export { normalizeBaseUrl, parseModels } from './providers.js'

/** Id the runtime's single `models.json` entry is written under. */
export const PROVIDER_ID = 'pictor'

export const EMPTY_MODEL_SETTINGS: ModelSettings = {
  providerId: null,
  providerName: '',
  baseUrl: '',
  protocol: 'openai-completions',
  modelId: '',
  models: [],
  hasApiKey: false,
}

/**
 * The configuration the runtime should use: the providers list collapsed onto
 * whichever provider is active.
 *
 * Pi is configured with one provider entry, so multi-provider is a settings-level
 * idea — the active one is what gets written to `models.json` and what the chat
 * client resolves models against.
 */
export async function readModelSettings(
  store: SettingsStore,
  authPath: string,
): Promise<ModelSettings> {
  return toSettings(await readProviders(store, authPath))
}

function toSettings(list: ProviderList): ModelSettings {
  const active =
    list.providers.find((provider) => provider.id === list.activeId) ?? list.providers[0] ?? null
  if (active === null) return EMPTY_MODEL_SETTINGS

  return {
    providerId: active.id,
    providerName: active.name,
    baseUrl: active.baseUrl,
    protocol: active.protocol,
    modelId: active.modelId,
    models: active.models,
    hasApiKey: active.hasApiKey,
  }
}

/**
 * Saves the active provider, adding one when none exists.
 *
 * The page edits providers individually through `saveProvider`; this entry point
 * stays for the flows that describe "the model I am using" instead of a record.
 */
export async function saveModelSettings(
  store: SettingsStore,
  authPath: string,
  input: ModelSettingsInput,
): Promise<ModelSettings> {
  const current = await readProviders(store, authPath)
  await saveProvider(store, authPath, {
    ...(current.activeId === null ? {} : { id: current.activeId }),
    name: input.providerName,
    baseUrl: input.baseUrl,
    protocol: input.protocol,
    modelId: input.modelId,
    models: input.models,
    ...(input.apiKey === undefined ? {} : { apiKey: input.apiKey }),
  })

  return readModelSettings(store, authPath)
}

/**
 * Switches the model of the active provider.
 *
 * The stored list is the source of truth: an id that is not in it is rejected so
 * a typo cannot silently break every conversation opened afterwards.
 */
export async function selectModel(
  store: SettingsStore,
  authPath: string,
  modelId: string,
): Promise<ModelSettings> {
  const current = await readProviders(store, authPath)
  const activeId = current.activeId ?? current.providers[0]?.id ?? null
  if (activeId === null) throw new Error('no provider configured')

  await setProviderModel(store, authPath, activeId, modelId)
  return readModelSettings(store, authPath)
}

export { EMPTY_PROVIDER_LIST }
