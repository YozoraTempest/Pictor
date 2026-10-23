import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

import { HarnessClient, type HarnessNotification } from '@pictor/harness'

import type { ModelService } from './model-service.js'

export interface HarnessStatus {
  state: 'stopped' | 'starting' | 'ready' | 'error'
  /** Launcher the app would run, or null when no runtime is installed. */
  binary: string | null
  /** Isolated runtime home: profiles, sessions and storages live here. */
  home: string
  provider: string | null
  model: string | null
  serverInfo: { name: string; version: string } | null
  error: string | null
}

export interface HarnessServiceOptions {
  model: ModelService
  /** `app.getPath('userData')`; the runtime gets its own directory inside it. */
  userData: string
  /** Overrides discovery, for a bundled runtime or a development checkout. */
  binary?: string
}

/** Route the DeepSeek adapter registers; models pass through unchanged. */
const PROVIDER_ROUTE = 'deepseek-official'

/**
 * The agent runtime, as the main process uses it.
 *
 * Pictor keeps no agent loop of its own: it boots the DeepSeek Harness SDK
 * runtime as a child process and forwards its notifications. The model settings
 * the user already configured are mapped onto the environment the runtime reads,
 * so a service saved in the settings page is the service conversations use.
 */
export class HarnessService {
  readonly #options: HarnessServiceOptions
  readonly #listeners = new Set<(notification: HarnessNotification) => void>()
  #client: HarnessClient | null = null
  #status: HarnessStatus

  constructor(options: HarnessServiceOptions) {
    this.#options = options
    const binary = this.#resolveBinary()
    this.#status = {
      state: 'stopped',
      binary,
      home: join(options.userData, 'harness'),
      provider: null,
      model: null,
      serverInfo: null,
      error: binary === null ? '未安装 agent 运行时；设置里指定 dsh 启动器路径' : null,
    }
  }

  status(): HarnessStatus {
    return { ...this.#status }
  }

  /** Subscribe to runtime notifications; the caller forwards them to windows. */
  onNotification(listener: (notification: HarnessNotification) => void): () => void {
    this.#listeners.add(listener)
    return () => {
      this.#listeners.delete(listener)
    }
  }

  /**
   * Boot the runtime for one working directory.
   *
   * Credentials are read from the active service at boot: the runtime resolves
   * them per request from its environment, so rotating a key means restarting it.
   */
  async start(cwd: string): Promise<HarnessStatus> {
    if (this.#status.state === 'ready') return this.status()
    // Narrow once: `start` replaces the status object below, so a re-read would
    // lose the non-null guarantee.
    const binary = this.#status.binary
    if (binary === null) {
      throw new Error(this.#status.error ?? 'agent 运行时不可用')
    }

    const settings = await this.#options.model.settings()
    if (settings.baseUrl.length === 0 || settings.modelId.length === 0) {
      throw new Error('先在「智能体 › 模型」里保存一个可用的服务')
    }
    const apiKey = await this.#options.model.activeApiKey()
    if (apiKey === null) {
      throw new Error('当前服务没有保存密钥')
    }

    this.#status = {
      ...this.#status,
      state: 'starting',
      provider: PROVIDER_ROUTE,
      model: settings.modelId,
      error: null,
    }

    const client = new HarnessClient({
      binary,
      home: this.#status.home,
      provider: PROVIDER_ROUTE,
      model: settings.modelId,
      // The runtime reads these two names; anything else is Pictor's own.
      env: { DEEPSEEK_BASE_URL: settings.baseUrl, DEEPSEEK_API_KEY: apiKey },
    })
    client.onNotification((notification) => {
      for (const listener of this.#listeners) listener(notification)
    })

    try {
      const result = await client.start(cwd)
      this.#client = client
      this.#status = {
        ...this.#status,
        state: 'ready',
        serverInfo: { name: result.serverInfo.name, version: result.serverInfo.version },
      }
      return this.status()
    } catch (error) {
      await client.stop().catch(() => undefined)
      this.#status = {
        ...this.#status,
        state: 'error',
        error: error instanceof Error ? error.message : String(error),
      }
      return this.status()
    }
  }

  async stop(): Promise<HarnessStatus> {
    const client = this.#client
    this.#client = null
    if (client !== null) await client.stop().catch(() => undefined)
    this.#status = { ...this.#status, state: 'stopped', serverInfo: null }
    return this.status()
  }

  /** Queue one user message; the runtime lazily creates the session. */
  async prompt(sessionId: string, text: string): Promise<void> {
    const client = this.#client
    if (client === null) throw new Error('agent 运行时尚未启动')
    await client.prompt(sessionId, [{ type: 'text', text }])
  }

  /**
   * Find the launcher: an explicit path, the environment override, then the
   * `@deepseek-ai/dsh` install that may live in the workspace.
   */
  #resolveBinary(): string | null {
    const explicit = this.#options.binary ?? process.env['PICTOR_DSH_BIN']
    if (explicit !== undefined && explicit.length > 0) {
      return existsSync(explicit) ? explicit : null
    }

    try {
      const require = createRequire(import.meta.url)
      const manifest = require.resolve('@deepseek-ai/dsh/package.json')
      const candidate = join(dirname(manifest), 'lib/cli.js')
      if (existsSync(candidate)) return candidate
    } catch {
      // Not installed next to the app; the settings page explains what to do.
    }
    return null
  }
}
