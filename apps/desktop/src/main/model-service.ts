import { existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { PiAgentRuntime } from '@pictor/agent-runtime'
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
  writeModelsJson,
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

export interface AgentTestResult {
  ok: boolean
  text: string
  events: string[]
  message?: string
}

const DEFAULT_CC_SWITCH_PATH = join(homedir(), '.cc-switch', 'cc-switch.db')

/**
 * Owns model configuration for the main process.
 *
 * Secrets live in `<userData>/auth.json`; Pi's `models.json` references them
 * through an environment variable, and the renderer only ever sees a boolean.
 */
export class ModelService {
  readonly #store: MetadataStore
  readonly #authPath: string
  readonly #modelsPath: string
  readonly #agentDir: string
  readonly #ccSwitchPath: string

  constructor(options: ModelServiceOptions) {
    this.#store = options.store
    this.#authPath = join(options.userData, 'auth.json')
    this.#modelsPath = join(options.userData, 'pi', 'models.json')
    this.#agentDir = join(options.userData, 'pi', 'agent')
    this.#ccSwitchPath =
      options.ccSwitchPath ?? (process.env.PICTOR_CCSWITCH_DB?.trim() || DEFAULT_CC_SWITCH_PATH)
  }

  get authPath(): string {
    return this.#authPath
  }

  get modelsPath(): string {
    return this.#modelsPath
  }

  get agentDir(): string {
    return this.#agentDir
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

  /**
   * Runs one real agent turn with tools disabled and waits for it to finish.
   *
   * This is the end-to-end proof that the endpoint, key, protocol, generated
   * `models.json` and the Pi adapter all agree.
   */
  async runTest(prompt: string, workingDirectory: string): Promise<AgentTestResult> {
    const settings = await this.settings()
    if (settings.baseUrl.length === 0 || settings.modelId.length === 0) {
      return { ok: false, text: '', events: [], message: 'Model settings are incomplete' }
    }

    mkdirSync(this.#agentDir, { recursive: true })
    writeModelsJson(this.#modelsPath, settings)

    const apiKey = await this.activeApiKey()
    const runtime = new PiAgentRuntime({
      loadConfig: async () => ({
        modelId: settings.modelId,
        modelsPath: this.#modelsPath,
        agentDir: this.#agentDir,
        apiKey,
        workingDirectory,
      }),
    })

    const events: string[] = []
    let text = ''
    let message: string | undefined
    let finish: () => void = () => undefined

    const done = new Promise<void>((resolve) => {
      finish = resolve
    })

    const handle = await runtime.run(
      { runId: `test-${Date.now()}`, prompt, workingDirectory },
      (event) => {
        if (event.type === 'message.delta') {
          text += event.text
          return
        }

        events.push(event.type)

        if (event.type === 'run.finished') {
          if (event.reason === 'error') message = event.message ?? 'agent run failed'
          finish()
        }
      },
    )

    const timeout = new Promise<void>((resolve) => {
      setTimeout(() => {
        message = message ?? 'agent run timed out'
        handle.cancel()
        resolve()
      }, 120_000)
    })

    await Promise.race([done, timeout])

    return {
      ok: message === undefined && text.length > 0,
      text,
      events,
      ...(message === undefined ? {} : { message }),
    }
  }
}
