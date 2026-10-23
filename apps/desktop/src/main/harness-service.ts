import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { dirname, join, sep } from 'node:path'

import {
  FollowStream,
  HarnessRemote,
  type HarnessNotification,
  type SessionCreateValue,
  type SessionFollowFrame,
  type SessionPromptValue,
  type SessionWireEvent,
  type WebSocketConstructor,
  type WebSocketLike,
} from '@pictor/harness'

import type { ChatHistoryPage, ModelSettings } from '@pictor/shared'

import { loadHarnessHistory } from './harness-history.js'
import { buildProfilePatch, PROFILE_BUNDLES, ROUTE, ROUTE_API_KEY_ENV } from './harness-profile.js'
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
  /** Sandbox permission mode the runtime is (or will be) booted with. */
  permissionMode: PermissionMode
  error: string | null
}

export type PermissionMode = 'read-only' | 'workspace-write' | 'danger-full-access'

export const DEFAULT_PERMISSION_MODE: PermissionMode = 'workspace-write'

export function isPermissionMode(value: unknown): value is PermissionMode {
  return value === 'read-only' || value === 'workspace-write' || value === 'danger-full-access'
}

export interface HarnessServiceOptions {
  model: ModelService
  /** `app.getPath('userData')`; the runtime gets its own directory inside it. */
  userData: string
  /** Overrides discovery, for a bundled runtime or a development checkout. */
  binary?: string
  /** Sandbox mode read from settings; the runtime takes it as an env var. */
  readPermissionMode?: () => Promise<PermissionMode>
}

/** Pinned runtime, installed into the profile on request. */
const RUNTIME_PACKAGE = '@deepseek-ai/dsh@0.2.1-rc.2'

/** Pictor's own profile: the stock base plus the HTTP/WebSocket host. */
const PROFILE_NAME = 'pictor'

/** How long a cold runtime may take to print its origin. */
const BOOT_TIMEOUT = 120_000

/** Messages the opening snapshot carries; the transcript pages back through it. */
const SNAPSHOT_MESSAGES = 200

/** `ws` is the only client that can send a cookie header on the upgrade. */
type WebSocketModule = WebSocketConstructor | { default: WebSocketConstructor }

function loadWebSocket(): WebSocketConstructor | null {
  try {
    const require = createRequire(import.meta.url)
    const loaded = require('ws') as WebSocketModule
    const constructor =
      typeof loaded === 'function' ? loaded : (loaded as { default?: unknown }).default
    if (typeof constructor !== 'function') return null
    // `ws` exports a class, while the stream asks for a factory: the indirection
    // is what lets a test pass a recorder instead of a real socket.
    const Class = constructor as unknown as new (
      url: string,
      options: { headers: Record<string, string> },
    ) => WebSocketLike
    return (url, options) => new Class(url, options)
  } catch {
    // A build without `ws` can still boot the runtime; it just cannot stream.
  }
  return null
}

interface BootResult {
  baseUrl: string
  token: string
}

interface BootOptions {
  binary: string
  nodePath: string
  root: string
  home: string
  env: Record<string, string>
  diagnostics: string[]
}

/**
 * The agent runtime, as the main process uses it.
 *
 * Pictor keeps no agent loop of its own: it boots the DeepSeek Harness web
 * profile as a child process and talks to it the way the browser UI does — unary
 * calls over `POST /api`, live session events over one WebSocket. That is the
 * only transport that can stream tokens, and it is also what makes several
 * windows (or a future remote client) able to follow the same session.
 *
 * The model settings the user already configured are mapped onto the environment
 * the runtime reads, so a service saved in the settings page is the service
 * conversations use.
 */
export class HarnessService {
  readonly #options: HarnessServiceOptions
  readonly #listeners = new Set<(notification: HarnessNotification) => void>()
  readonly #follows = new Map<string, FollowStream>()
  /** Pictor session id → runtime session id; persisted so restarts reattach. */
  readonly #sessions = new Map<string, string>()
  /** Live mirror of each session log: the opening window plus every later event. */
  readonly #snapshots = new Map<string, SessionWireEvent[]>()
  #status: HarnessStatus
  #remote: HarnessRemote | null = null
  #socket: WebSocketConstructor | null = null
  #child: ChildProcess | null = null
  #cwd: string | null = null
  #sessionsLoaded = false

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
      permissionMode: DEFAULT_PERMISSION_MODE,
      error: binary === null ? '未安装 agent 运行时；设置里指定 dsh 启动器路径' : null,
    }
  }

  status(): HarnessStatus {
    return { ...this.#status }
  }

  /** Record the configured mode before a read, so status reflects the setting. */
  setPermissionMode(mode: PermissionMode): void {
    if (this.#status.permissionMode === mode) return
    this.#status = { ...this.#status, permissionMode: mode }
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

    const stored = await this.#options.readPermissionMode?.()
    const permissionMode = isPermissionMode(stored) ? stored : DEFAULT_PERMISSION_MODE

    this.#status = {
      ...this.#status,
      state: 'starting',
      permissionMode,
      provider: ROUTE,
      model: settings.modelId,
      error: null,
    }

    const nodePath = this.#resolveNode()
    if (nodePath === null) {
      throw new Error('没有找到可用的 Node 运行时；安装 Node 22+ 或设置 PICTOR_NODE_BIN')
    }

    const socket = loadWebSocket()
    if (socket === null) {
      throw new Error('缺少 ws 依赖，无法订阅运行时的会话流')
    }

    this.#cwd = cwd
    this.#loadSessions()
    const home = this.#status.home
    this.#ensureProfile(settings)

    const diagnostics: string[] = []
    const env = {
      // The route resolves this per request, so the key never reaches the patch
      // file or the session log.
      [ROUTE_API_KEY_ENV]: apiKey,
      // `web_search` reaches DeepSeek through its own client and reads this name
      // regardless of which route the conversation uses.
      DEEPSEEK_API_KEY: apiKey,
      // The stock profile reads exactly this variable for its sandbox and
      // approval defaults, so the choice survives a runtime swap.
      DSH_PERMISSION_MODE: permissionMode,
    }

    try {
      const boot = await this.#boot({
        binary,
        nodePath,
        root: this.#runtimeRoot(binary),
        home,
        env,
        diagnostics,
      })
      const remote = new HarnessRemote({ baseUrl: boot.baseUrl, token: boot.token })
      await remote.connect()

      this.#remote = remote
      this.#socket = socket
      this.#status = {
        ...this.#status,
        state: 'ready',
        serverInfo: { name: 'deepseek-harness-web', version: this.#runtimeVersion(binary) },
      }
      return this.status()
    } catch (error) {
      this.#kill()
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
    for (const stream of this.#follows.values()) stream.close()
    this.#follows.clear()
    this.#remote = null
    this.#socket = null
    this.#kill()
    this.#status = { ...this.#status, state: 'stopped', serverInfo: null }
    return this.status()
  }

  /**
   * Queue one user message.
   *
   * The runtime owns sessions: the first prompt for a Pictor session creates it
   * there under the same id, and the follow stream is opened before the prompt so
   * the very first token is not missed.
   */
  async prompt(sessionId: string, text: string): Promise<void> {
    const remote = this.#remote
    if (remote === null) throw new Error('agent 运行时尚未启动')

    const harnessId = await this.#sessionFor(sessionId)
    await this.#ensureFollow(harnessId)
    await remote.call<SessionPromptValue>('session/prompt', {
      request: {
        requestId: randomUUID(),
        sessionId: harnessId,
        mode: 'queue',
        content: [{ type: 'text', text }],
      },
    })
  }

  /** Stop the turn the runtime is running for one session. */
  async cancel(sessionId: string): Promise<void> {
    const remote = this.#remote
    if (remote === null) return
    const harnessId = this.#sessions.get(sessionId) ?? sessionId
    await remote.call('session/cancel', { request: { sessionId: harnessId } })
  }

  /**
   * Install the pinned runtime into the profile.
   *
   * The app ships no package manager and no bundler for the runtime, so the
   * install runs npm through the same Node the runtime will use, into a
   * directory this profile owns. Nothing global is touched, and uninstalling is
   * deleting the directory.
   */
  async install(): Promise<HarnessStatus> {
    const nodePath = this.#resolveNode()
    if (nodePath === null) {
      throw new Error('没有找到可用的 Node 运行时；安装 Node 22+ 或设置 PICTOR_NODE_BIN')
    }
    const npmCli = this.#resolveNpmCli(nodePath)
    if (npmCli === null) throw new Error('没有找到 npm，无法安装运行时')

    // Surface progress: the install takes minutes and the page should say so.
    this.#status = { ...this.#status, state: 'starting', error: null }

    const directory = join(this.#options.userData, 'harness-runtime')
    mkdirSync(directory, { recursive: true })
    const manifest = join(directory, 'package.json')
    if (!existsSync(manifest)) {
      writeFileSync(
        manifest,
        `${JSON.stringify({ name: 'pictor-runtime', private: true }, null, 2)}\n`,
        'utf8',
      )
    }

    const output: string[] = []
    const code = await new Promise<number>((resolve) => {
      const child = spawn(
        nodePath,
        [npmCli, 'install', RUNTIME_PACKAGE, '--no-audit', '--no-fund', '--loglevel=error'],
        { cwd: directory, env: { ...process.env } },
      )
      const collect = (chunk: Buffer | string): void => {
        for (const line of String(chunk).split('\n')) {
          if (line.trim().length > 0) output.push(line.trim())
        }
      }
      child.stdout.on('data', collect)
      child.stderr.on('data', collect)
      child.on('error', (error) => {
        output.push(String(error))
        resolve(1)
      })
      child.on('exit', (exitCode) => resolve(exitCode ?? 1))
    })

    const tail = output.slice(-4).join(' · ')
    const binary = this.#resolveBinary()
    this.#status = {
      ...this.#status,
      state: 'stopped',
      binary,
      error: code === 0 && binary !== null ? null : tail.length > 0 ? tail : '安装失败',
    }
    return this.status()
  }

  /** Spawn the web runtime and wait for the origin it prints. */
  #boot(options: BootOptions): Promise<BootResult> {
    const { binary, nodePath, root, home, env, diagnostics } = options
    const isScript = /\.(c|m)?js$/.test(binary)
    const command = isScript ? nodePath : binary
    // `--port 0` lets the OS pick a free port, so several Pictor windows never
    // fight over one number; `--no-open` keeps the desktop from launching a
    // browser this app is meant to replace.
    const args = [
      ...(isScript ? [binary] : []),
      '--profile',
      PROFILE_NAME,
      '--host',
      '127.0.0.1',
      '--port',
      '0',
      '--no-open',
    ]

    return new Promise<BootResult>((resolve, reject) => {
      const child = spawn(command, args, {
        cwd: root,
        env: {
          ...process.env,
          ...(isScript ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
          DSH_HOME: home,
          ...env,
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      this.#child = child

      let settled = false
      let buffer = ''
      const finish = (error: Error | null, result?: BootResult): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (error !== null) reject(error)
        else if (result !== undefined) resolve(result)
      }
      const timer = setTimeout(() => {
        finish(new Error(`运行时在 ${String(BOOT_TIMEOUT)}ms 内没有就绪`))
        child.kill('SIGTERM')
      }, BOOT_TIMEOUT)

      child.stdout?.setEncoding('utf8')
      child.stdout?.on('data', (chunk: string) => {
        buffer += chunk
        this.#emit({ method: 'runtime.stdout', params: { text: chunk } })
        const match = /(https?:\/\/[^\s/]+)\/?\?token=([A-Za-z0-9_-]+)/.exec(buffer)
        const baseUrl = match?.[1]
        const token = match?.[2]
        if (baseUrl !== undefined && token !== undefined) {
          finish(null, { baseUrl, token })
        }
      })
      child.stderr?.setEncoding('utf8')
      child.stderr?.on('data', (chunk: string) => {
        diagnostics.push(chunk)
        this.#emit({ method: 'runtime.stderr', params: { text: chunk } })
      })
      child.on('error', (error) => {
        finish(error instanceof Error ? error : new Error(String(error)))
      })
      child.on('exit', (code, signal) => {
        const detail = diagnostics.join('').trim().split('\n').slice(-3).join(' ')
        finish(
          new Error(
            `运行时启动失败 (code=${String(code)} signal=${String(signal)})${detail.length > 0 ? ` · ${detail}` : ''}`,
          ),
        )
        this.#handleExit()
      })
    })
  }

  #handleExit(): void {
    const wasReady = this.#status.state === 'ready'
    for (const stream of this.#follows.values()) stream.close()
    this.#follows.clear()
    this.#remote = null
    this.#socket = null
    this.#child = null
    this.#status = {
      ...this.#status,
      state: wasReady ? 'error' : this.#status.state,
      serverInfo: null,
      error: wasReady ? 'agent 运行时已退出' : this.#status.error,
    }
  }

  #kill(): () => void {
    const child = this.#child
    this.#child = null
    if (child === null) return () => undefined
    try {
      child.kill('SIGTERM')
    } catch {
      // Already gone.
    }
    // A runtime that ignores SIGTERM must not outlive the window that owns it.
    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL')
      } catch {
        // Already gone.
      }
    }, 3_000)
    timer.unref?.()
    return () => clearTimeout(timer)
  }

  /** Runtime session id for one Pictor session, creating it on first use. */
  async #sessionFor(pictorId: string): Promise<string> {
    const known = this.#sessions.get(pictorId)
    if (known !== undefined) return known

    const remote = this.#remote
    if (remote === null) throw new Error('agent 运行时尚未启动')
    const created = await remote.call<SessionCreateValue>('session/create', {
      request: { cwd: this.#cwd ?? homedir(), sessionId: pictorId },
    })
    this.#sessions.set(pictorId, created.sessionId)
    this.#persistSessions()
    return created.sessionId
  }

  /** The Pictor id a runtime session belongs to, so events reach the right window. */
  #pictorIdOf(harnessId: string): string {
    for (const [pictor, harness] of this.#sessions) {
      if (harness === harnessId) return pictor
    }
    return harnessId
  }

  /** Subscribe to one runtime session once; frames become ordinary notifications. */
  async #ensureFollow(harnessId: string, options: { silent?: boolean } = {}): Promise<void> {
    const held = this.#follows.get(harnessId)
    if (held !== undefined) {
      // A stream that already closed still occupies the slot, and the next
      // prompt would then stream into nothing.
      if (held.active) return
      this.#follows.delete(harnessId)
    }
    const remote = this.#remote
    const socket = this.#socket
    const cookie = remote?.cookie
    if (remote === null || socket === null || cookie === undefined || cookie === null) {
      throw new Error('agent 运行时尚未就绪')
    }

    const stream: FollowStream = new FollowStream({
      url: `${remote.baseUrl.replace(/^http/, 'ws')}/api/remote.mux`,
      cookie,
      WebSocket: socket,
      onFrame: (frame: SessionFollowFrame) => {
        if (frame.type === 'snapshot') {
          this.#snapshots.set(
            harnessId,
            frame.records.map((record) => record.event),
          )
        } else if (frame.type === 'event') {
          // The opening window is a cut, not the whole session: later events keep
          // the mirror current, so history reflects what the user just watched.
          this.#snapshots.get(harnessId)?.push(frame.event)
        }
        if (process.env['PICTOR_DEBUG_HARNESS'] === '1') {
          const detail =
            frame.type === 'assistant-stream'
              ? ` ${frame.frame.type}${
                  frame.frame.type === 'chunk'
                    ? ` ${JSON.stringify(frame.frame.chunk).slice(0, 200)}`
                    : ''
                }`
              : ''
          console.info(`[harness] follow ${frame.type}${detail}`)
        }
        this.#emit({
          method: 'session.follow',
          params: { sessionId: this.#pictorIdOf(harnessId), frame },
        })
      },
      onError: (error) => {
        // Opening history for a session the runtime does not know is expected;
        // only a live subscription reports its own failure.
        if (options.silent === true) return
        this.#emit({
          method: 'agent.error',
          params: { sessionId: this.#pictorIdOf(harnessId), message: error.message },
        })
      },
      onClose: () => {
        if (this.#follows.get(harnessId) === stream) this.#follows.delete(harnessId)
      },
    })
    this.#follows.set(harnessId, stream)
    await stream.open({
      address: { kind: 'session', sessionId: harnessId },
      // The opening window doubles as the first history page, so it has to hold
      // enough that the transcript can page back through it.
      maxMessages: SNAPSHOT_MESSAGES,
      assistantStream: true,
    })
  }

  /** Opening history for one Pictor session, read from the runtime itself. */
  async openHistory(pictorSessionId: string): Promise<ChatHistoryPage> {
    return this.historyPage(pictorSessionId, 50, 0)
  }

  /**
   * One page of stored history.
   *
   * The source is the subscription's opening window: it is the same data the
   * live stream starts from, so a transcript cannot disagree with itself, and it
   * needs no knowledge of how the runtime lays its log out on disk.
   */
  async historyPage(
    pictorSessionId: string,
    limit: number,
    offset: number,
  ): Promise<ChatHistoryPage> {
    const known = this.#sessions.get(pictorSessionId)
    // A session the runtime has never created has no history — and subscribing
    // for it would leave a live-but-empty stream in the slot the first prompt
    // needs, so the prompt would be queued for nobody.
    if (known === undefined) return loadHarnessHistory([], limit, offset)
    const harnessId = known
    const events = this.#snapshots.get(harnessId) ?? (await this.#loadSnapshot(harnessId))
    return loadHarnessHistory(events ?? [], limit, offset)
  }

  /** Take the opening window for a session, or null when the runtime has none. */
  async #loadSnapshot(harnessId: string): Promise<readonly SessionWireEvent[] | null> {
    try {
      await this.#ensureFollow(harnessId, { silent: true })
    } catch {
      return null
    }
    return this.#snapshots.get(harnessId) ?? null
  }

  #profileDirectory(): string {
    return join(this.#status.home, 'profiles', PROFILE_NAME)
  }

  /**
   * Write the profile the runtime boots.
   *
   * The manifest is written once, because a user may install plugins into it
   * later. The patch is rewritten on every boot: it is a projection of the
   * settings page, so a stale copy would describe a provider that no longer
   * exists.
   */
  #ensureProfile(settings: ModelSettings): void {
    const directory = this.#profileDirectory()
    mkdirSync(directory, { recursive: true })
    const manifest = join(directory, 'package.json')
    if (!existsSync(manifest)) {
      writeFileSync(
        manifest,
        `${JSON.stringify(
          {
            name: `dsh-profile-${PROFILE_NAME}`,
            private: true,
            dependencies: {},
            dsh: { profile: { bundles: PROFILE_BUNDLES } },
          },
          null,
          2,
        )}\n`,
        'utf8',
      )
    }
    writeFileSync(
      join(directory, 'cordis.patch.yml'),
      buildProfilePatch({
        protocol: settings.protocol,
        baseUrl: settings.baseUrl,
        modelId: settings.modelId,
        models: settings.models,
      }),
      'utf8',
    )
  }

  #sessionsFile(): string {
    return join(this.#status.home, 'pictor-sessions.json')
  }

  #loadSessions(): void {
    if (this.#sessionsLoaded) return
    this.#sessionsLoaded = true
    try {
      const raw = readFileSync(this.#sessionsFile(), 'utf8')
      const parsed = JSON.parse(raw) as Record<string, unknown>
      for (const [pictor, harness] of Object.entries(parsed)) {
        if (typeof harness === 'string' && harness.length > 0) this.#sessions.set(pictor, harness)
      }
    } catch {
      // No mapping yet: the first prompt creates each session.
    }
  }

  #persistSessions(): void {
    try {
      mkdirSync(this.#status.home, { recursive: true })
      writeFileSync(
        this.#sessionsFile(),
        `${JSON.stringify(Object.fromEntries(this.#sessions), null, 2)}\n`,
        'utf8',
      )
    } catch {
      // A read-only profile only costs a duplicated session, never the turn.
    }
  }

  /** Directory whose `node_modules` resolves the profile's bundles. */
  #runtimeRoot(binary: string): string {
    const marker = `${sep}node_modules${sep}`
    const index = binary.lastIndexOf(marker)
    if (index >= 0) return binary.slice(0, index)
    return dirname(binary)
  }

  #runtimeVersion(binary: string): string {
    let directory = this.#runtimeRoot(binary)
    for (let depth = 0; depth < 4; depth += 1) {
      const manifest = join(directory, 'node_modules/@deepseek-ai/dsh/package.json')
      if (existsSync(manifest)) {
        try {
          const parsed = JSON.parse(readFileSync(manifest, 'utf8')) as { version?: unknown }
          if (typeof parsed.version === 'string') return parsed.version
        } catch {
          return 'unknown'
        }
      }
      directory = dirname(directory)
    }
    return 'unknown'
  }

  #emit(notification: HarnessNotification): void {
    for (const listener of this.#listeners) {
      try {
        listener(notification)
      } catch {
        // A broken listener must not break the channel for the others.
      }
    }
  }

  /** npm ships inside a Node installation; find its JS entry for this Node. */
  #resolveNpmCli(nodePath: string): string | null {
    const explicit = process.env['PICTOR_NPM_CLI']
    if (explicit !== undefined && existsSync(explicit)) return explicit

    const candidates = [
      join(dirname(nodePath), '../lib/node_modules/npm/bin/npm-cli.js'),
      '/usr/lib/node_modules/npm/bin/npm-cli.js',
      '/usr/local/lib/node_modules/npm/bin/npm-cli.js',
    ]
    for (const candidate of candidates) {
      if (existsSync(candidate)) return candidate
    }
    return null
  }

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

    // An install the user triggered from the settings page wins: it is the one
    // this profile owns, and it needs no PATH or global npm.
    const local = join(
      this.#options.userData,
      'harness-runtime/node_modules/@deepseek-ai/dsh/lib/bin.js',
    )
    if (existsSync(local)) return local

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

export type { WebSocketLike }
