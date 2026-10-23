import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
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

    const nodePath = this.#resolveNode()
    if (nodePath === null) {
      throw new Error('没有找到可用的 Node 运行时；安装 Node 22+ 或设置 PICTOR_NODE_BIN')
    }

    const client = new HarnessClient({
      binary,
      home: this.#status.home,
      nodePath,
      provider: PROVIDER_ROUTE,
      model: settings.modelId,
      // The runtime reads these two names; anything else is Pictor's own.
      env: { DEEPSEEK_BASE_URL: settings.baseUrl, DEEPSEEK_API_KEY: apiKey },
    })
    const diagnostics: string[] = []
    client.onNotification((notification) => {
      // Keep the runtime's own diagnostics: a launcher that exits during boot
      // usually explains itself on stderr, and the status is the only place the
      // user can read it.
      if (notification.method === 'runtime.stderr') {
        const text = (notification.params as { text?: string } | null)?.text ?? ''
        if (text.length > 0) diagnostics.push(text)
      }
      for (const listener of this.#listeners) listener(notification)
    })

    console.info('[harness] spawn', {
      binary,
      node: process.env['PATH']
        ?.split(':')
        .filter((entry) => entry.includes('node'))
        .slice(0, 3),
      nodeOptions: process.env['NODE_OPTIONS'] ?? null,
      electronRunAsNode: process.env['ELECTRON_RUN_AS_NODE'] ?? null,
      baseUrl: settings.baseUrl,
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
      const detail = diagnostics.join('').trim().split('\n').slice(-4).join(' ')
      this.#status = {
        ...this.#status,
        state: 'error',
        error: [error instanceof Error ? error.message : String(error), detail]
          .filter((part) => part.length > 0)
          .join(' · '),
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
  /**
   * Find a plain Node binary for the runtime.
   *
   * The launcher refuses to run under Electron's embedded node (it fingerprints
   * the runtime and only accepts specific Electron builds), so the app must hand
   * it a real Node 22+. The app's own PATH is not a reliable source: a packaged
   * Electron started from a desktop entry does not inherit a shell's fnm shims.
   */
  #resolveNode(): string | null {
    const explicit = process.env['PICTOR_NODE_BIN']
    if (explicit !== undefined && existsSync(explicit)) return explicit

    const roots = [
      join(homedir(), '.local/share/fnm/node-versions'),
      join(homedir(), '.fnm/node-versions'),
    ]
    for (const root of roots) {
      if (!existsSync(root)) continue
      const versions = readdirSync(root)
        .filter((entry) => entry.startsWith('v22.'))
        .sort()
        .reverse()
      for (const version of versions) {
        const candidate = join(root, version, 'installation/bin/node')
        if (existsSync(candidate)) return candidate
      }
    }

    for (const candidate of ['/usr/local/bin/node', '/usr/bin/node']) {
      if (existsSync(candidate)) return candidate
    }
    return null
  }

  #resolveBinary(): string | null {
    const explicit = this.#options.binary ?? process.env['PICTOR_DSH_BIN']
    if (explicit !== undefined && explicit.length > 0) {
      return existsSync(explicit) ? explicit : null
    }

    try {
      const require = createRequire(import.meta.url)
      const manifestPath = require.resolve('@deepseek-ai/dsh/package.json')
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
        bin?: string | Record<string, string>
      }
      const relative = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.['dsh']
      if (relative !== undefined) {
        const entry = join(dirname(manifestPath), relative)
        if (existsSync(entry)) return entry
      }
    } catch {
      // Not installed next to the app; the settings page explains what to do.
    }
    return null
  }
}
