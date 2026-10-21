import { existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { PiAgentRuntime } from '@pictor/agent-runtime'
import type { MetadataStore } from '@pictor/host-client'
import {
  PROVIDER_ID,
  fetchModels,
  readApiKey,
  readModelSettings,
  saveModelSettings,
  selectModel,
  testConnection,
  writeModelsJson,
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
        : readApiKey(this.#authPath, PROVIDER_ID)

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
      apiKey: readApiKey(this.#authPath, PROVIDER_ID),
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

  async importCcSwitchProvider(id: string, includeApiKey: boolean): Promise<ModelSettings> {
    const detail = await this.#store.readCcSwitchProvider(this.#ccSwitchPath, id)
    const protocol: ModelProtocol =
      detail.api === 'openai-responses' ? 'responses' : 'chat-completions'
    const modelId = detail.models[0]?.id ?? ''

    if (modelId.length === 0) {
      throw new Error('this cc-switch provider has no models')
    }

    return this.save({
      providerName: detail.name,
      baseUrl: detail.baseUrl,
      protocol,
      modelId,
      models: detail.models,
      ...(includeApiKey && detail.apiKey !== null ? { apiKey: detail.apiKey } : {}),
    })
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

    const apiKey = readApiKey(this.#authPath, PROVIDER_ID)
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
