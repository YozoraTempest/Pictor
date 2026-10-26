import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import type { MetadataStore } from '@pictor/host-client'
import {
  activateProvider,
  fetchModels,
  readApiKey,
  readModelSettings,
  readProviders,
  removeProvider,
  saveModelSettings,
  saveProvider,
  selectModel,
  testConnection,
  useModel,
  type ProviderInput,
  type ProviderList,
} from '@pictor/model-config'
import type {
  CcSwitchProviderSummary,
  ModelEntry,
  ModelProtocol,
  ModelSettings,
  ModelSettingsInput,
} from '@pictor/shared'

export interface ModelServiceOptions {
  store: MetadataStore
  userData: string
  ccSwitchPath?: string
}

export interface CcSwitchScanResult {
  available: boolean
  path: string
  providers: CcSwitchProviderSummary[]
}

const DEFAULT_CC_SWITCH_PATH = join(homedir(), '.cc-switch', 'cc-switch.db')

/**
 * Owns model configuration for the main process.
 *
 * Secrets live in `<userData>/auth.json` and never leave this process: the
 * runtime is handed its key through an environment variable, and the renderer
 * only ever sees a boolean.
 */
export class ModelService {
  readonly #store: MetadataStore
  readonly #authPath: string
  readonly #ccSwitchPath: string

  constructor(options: ModelServiceOptions) {
    this.#store = options.store
    this.#authPath = join(options.userData, 'auth.json')
    this.#ccSwitchPath =
      options.ccSwitchPath ?? (process.env.PICTOR_CCSWITCH_DB?.trim() || DEFAULT_CC_SWITCH_PATH)
  }

  get authPath(): string {
    return this.#authPath
  }

  async settings(): Promise<ModelSettings> {
    return readModelSettings(this.#store, this.#authPath)
  }

  async save(input: ModelSettingsInput): Promise<ModelSettings> {
    return saveModelSettings(this.#store, this.#authPath, input)
  }

  /** Switches the active model; the endpoint and key stay as they are. */
  async selectModel(modelId: string): Promise<ModelSettings> {
    return selectModel(this.#store, this.#authPath, modelId)
  }

  /**
   * Uses one model of one service, switching the service when it differs.
   *
   * The picker in the composer offers models from every service, so choosing one
   * is "use this", not "change a field of whichever service is active".
   */
  async useModel(providerId: string, modelId: string): Promise<ModelSettings> {
    await useModel(this.#store, this.#authPath, providerId, modelId)
    return readModelSettings(this.#store, this.#authPath)
  }

  /** Every configured provider, with whether each one holds a key. */
  async providers(): Promise<ProviderList> {
    return readProviders(this.#store, this.#authPath)
  }

  async saveProvider(input: ProviderInput): Promise<ProviderList> {
    return saveProvider(this.#store, this.#authPath, input)
  }

  async removeProvider(id: string): Promise<ProviderList> {
    return removeProvider(this.#store, this.#authPath, id)
  }

  /** Makes a provider the one conversations use. */
  async activateProvider(id: string): Promise<ProviderList> {
    return activateProvider(this.#store, this.#authPath, id)
  }

  /** Key stored for one provider, or null when it has none. */
  apiKeyOf(providerId: string): string | null {
    return readApiKey(this.#authPath, providerId)
  }

  /** Key of the provider the runtime would use, if any. */
  async activeApiKey(): Promise<string | null> {
    const settings = await this.settings()
    return settings.providerId === null ? null : readApiKey(this.#authPath, settings.providerId)
  }

  /**
   * Queries `/models`. The override lets the settings form test unsaved values;
   * `apiKey` falls back to the stored key.
   */
  async fetchModels(override?: {
    baseUrl?: string
    protocol?: ModelProtocol
    apiKey?: string
  }): Promise<ModelEntry[]> {
    const settings = await this.settings()
    const baseUrl = override?.baseUrl?.trim() || settings.baseUrl
    if (baseUrl.length === 0) throw new Error('Base URL is required')

    const apiKey =
      override?.apiKey !== undefined && override.apiKey.trim().length > 0
        ? override.apiKey.trim()
        : await this.activeApiKey()

    return fetchModels({
      baseUrl,
      protocol: override?.protocol ?? settings.protocol,
      apiKey,
    })
  }

  async test(): Promise<{ ok: boolean; message: string; sample: string }> {
    const settings = await this.settings()
    return testConnection({
      baseUrl: settings.baseUrl,
      protocol: settings.protocol,
      apiKey: await this.activeApiKey(),
      modelId: settings.modelId,
    })
  }

  async scanCcSwitch(): Promise<CcSwitchScanResult> {
    if (!existsSync(this.#ccSwitchPath)) {
      return { available: false, path: this.#ccSwitchPath, providers: [] }
    }

    const providers = await this.#store.scanCcSwitch(this.#ccSwitchPath)
    return { available: true, path: this.#ccSwitchPath, providers }
  }

  /**
   * Copies a cc-switch provider in as a new service and makes it the active one.
   *
   * Import used to overwrite the saved configuration, which made a single
   * mis-click destroy a working setup. A provider list can hold both, so an
   * import is additive: nothing already configured is touched.
   */
  async importCcSwitchProvider(id: string, includeApiKey: boolean): Promise<ProviderList> {
    const detail = await this.#store.readCcSwitchProvider(this.#ccSwitchPath, id)
    // cc-switch stores the runtime's own protocol name, so an import needs no
    // translation; an unknown string falls back to the most common wire format.
    const protocol: ModelProtocol =
      detail.api === 'openai-responses' || detail.api === 'anthropic-messages'
        ? detail.api
        : 'openai-completions'
    const modelId = detail.models[0]?.id ?? ''

    if (modelId.length === 0) {
      throw new Error('this cc-switch provider has no models')
    }

    const list = await saveProvider(this.#store, this.#authPath, {
      name: detail.name,
      baseUrl: detail.baseUrl,
      protocol,
      modelId,
      models: detail.models,
      ...(includeApiKey && detail.apiKey !== null ? { apiKey: detail.apiKey } : {}),
    })

    const imported = list.providers[list.providers.length - 1]
    return imported === undefined
      ? list
      : activateProvider(this.#store, this.#authPath, imported.id)
  }
}
