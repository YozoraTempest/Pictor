import { spawn, type ChildProcessWithoutNullStreams, type SpawnOptions } from 'node:child_process'
import { mkdirSync } from 'node:fs'

import {
  NOTIFICATION,
  isJsonRpcNotification,
  isJsonRpcResponse,
  normalizeMethod,
  type InitializeParams,
  type InitializeResult,
  type JsonRpcResponse,
  type PromptContentBlock,
  type SessionEventNotification,
} from './protocol.js'

export interface HarnessSpawn {
  (binary: string, args: string[], options: SpawnOptions): ChildProcessWithoutNullStreams
}

export interface HarnessClientOptions {
  /** The `dsh` launcher. Callers resolve it; tests substitute a fake process. */
  binary: string
  /** Isolated runtime home: profiles, sessions and storages live under it. */
  home: string
  /** Provider route the runtime boots with, e.g. `deepseek-official`. */
  provider: string
  model: string
  /** Credentials travel in the environment, never in argv. */
  env?: Record<string, string>
  reasoningEffort?: string
  maxTokens?: number
  /** A prompt can legitimately take minutes; the handshake must not. */
  requestTimeoutMs?: number
  startTimeoutMs?: number
  spawn?: HarnessSpawn
}

export interface HarnessNotification {
  /** Normalised wire method, e.g. `session.event`. */
  method: string
  params: unknown
}

export type HarnessNotificationListener = (notification: HarnessNotification) => void

interface Pending {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
  method: string
}

const DEFAULT_REQUEST_TIMEOUT = 10 * 60 * 1000
const DEFAULT_START_TIMEOUT = 90 * 1000

/**
 * One SDK runtime process, as the rest of the app sees it.
 *
 * The runtime owns sessions, tools and the agent loop; Pictor owns the window.
 * Everything they share is newline-delimited JSON-RPC on stdio, so this class is
 * deliberately thin: spawn, correlate responses, fan out notifications, and make
 * sure a crashed runtime fails the calls waiting on it instead of hanging them.
 */
export class HarnessClient {
  readonly #options: HarnessClientOptions
  readonly #pending = new Map<number, Pending>()
  readonly #listeners = new Set<HarnessNotificationListener>()
  #child: ChildProcessWithoutNullStreams | null = null
  #buffer = ''
  #nextId = 1
  #exited = false

  constructor(options: HarnessClientOptions) {
    this.#options = options
  }

  get running(): boolean {
    return this.#child !== null && !this.#exited
  }

  /** Subscribe to runtime notifications; returns the unsubscribe function. */
  onNotification(listener: HarnessNotificationListener): () => void {
    this.#listeners.add(listener)
    return () => {
      this.#listeners.delete(listener)
    }
  }

  /** Boot the runtime and complete the SDK handshake. */
  async start(cwd: string): Promise<InitializeResult> {
    if (this.#child !== null) throw new Error('harness: already started')

    mkdirSync(this.#options.home, { recursive: true })
    // `spawn`'s overloads widen to `ChildProcess`; the stdio tuple below makes
    // the streams non-null, so the narrower type is the accurate one.
    const spawnProcess: HarnessSpawn = this.#options.spawn ?? (spawn as unknown as HarnessSpawn)
    const child = spawnProcess(this.#options.binary, ['--profile', 'sdk'], {
      cwd,
      env: {
        ...process.env,
        DSH_HOME: this.#options.home,
        ...this.#options.env,
      },
      stdio: ['pipe', 'pipe', 'pipe'] as const,
    } as SpawnOptions)

    this.#child = child
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      this.#consume(chunk)
    })
    // Diagnostics only: the protocol channel is stdout.
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      this.#emit({ method: 'runtime.stderr', params: { text: chunk } })
    })
    child.on('exit', (code, signal) => {
      this.#exited = true
      this.#failAll(
        new Error(`harness: runtime exited (code=${String(code)} signal=${String(signal)})`),
      )
    })
    child.on('error', (error) => {
      this.#exited = true
      this.#failAll(error instanceof Error ? error : new Error(String(error)))
    })

    const params: InitializeParams = {
      cwd,
      provider: this.#options.provider,
      model: this.#options.model,
      ...(this.#options.reasoningEffort === undefined
        ? {}
        : { reasoningEffort: this.#options.reasoningEffort }),
      ...(this.#options.maxTokens === undefined ? {} : { maxTokens: this.#options.maxTokens }),
    }

    const result = await this.#request(
      'initialize',
      params,
      this.#options.startTimeoutMs ?? DEFAULT_START_TIMEOUT,
    )
    if (typeof result !== 'object' || result === null || !('serverInfo' in result)) {
      throw new Error('harness: initialize returned an unexpected payload')
    }
    return result as InitializeResult
  }

  /** Queue one prompt. An unknown session id makes the runtime create it. */
  async prompt(sessionId: string, blocks: PromptContentBlock[]): Promise<void> {
    await this.#request('session/prompt', { sessionId, contentBlocks: blocks })
  }

  /** Block until the session and its descendants are idle. */
  async waitForIdle(sessionId: string): Promise<void> {
    await this.#request('session/wait', { sessionId })
  }

  /** Reattach a persisted session (after an app restart) without sending input. */
  async resume(sessionId: string): Promise<void> {
    await this.#request('session/resume', { sessionId })
  }

  /** Ask the runtime to release agents, then close the process. */
  async stop(): Promise<void> {
    const child = this.#child
    if (child === null) return

    try {
      await this.#request('shutdown', {}, 15_000)
    } catch {
      // A runtime that is already gone needs no shutdown.
    }

    this.#child = null
    this.#failAll(new Error('harness: stopped'))
    child.kill('SIGTERM')
  }

  #consume(chunk: string): void {
    this.#buffer += chunk
    let index = this.#buffer.indexOf('\n')
    while (index >= 0) {
      const line = this.#buffer.slice(0, index).trim()
      this.#buffer = this.#buffer.slice(index + 1)
      if (line.length > 0) this.#handleLine(line)
      index = this.#buffer.indexOf('\n')
    }
  }

  #handleLine(line: string): void {
    let message: unknown
    try {
      message = JSON.parse(line)
    } catch {
      // Never let one malformed line take the channel down.
      this.#emit({ method: 'runtime.malformed', params: { line: line.slice(0, 400) } })
      return
    }

    if (isJsonRpcResponse(message)) {
      this.#settle(message)
      return
    }
    if (isJsonRpcNotification(message)) {
      this.#emit({
        method: normalizeMethod(message.method),
        params: (message as { params?: unknown }).params,
      })
    }
  }

  #settle(response: JsonRpcResponse): void {
    const pending = this.#pending.get(response.id)
    if (pending === undefined) return
    this.#pending.delete(response.id)
    clearTimeout(pending.timer)

    if (response.error !== undefined) {
      pending.reject(new Error(`harness: ${pending.method} failed: ${response.error.message}`))
      return
    }
    pending.resolve(response.result)
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

  #failAll(error: Error): void {
    for (const [id, pending] of this.#pending) {
      clearTimeout(pending.timer)
      pending.reject(error)
      this.#pending.delete(id)
    }
  }

  #request(method: string, params: unknown, timeoutMs?: number): Promise<unknown> {
    const child = this.#child
    if (child === null || this.#exited) {
      return Promise.reject(new Error(`harness: cannot call ${method}; the runtime is not running`))
    }

    const id = this.#nextId++
    const limit = timeoutMs ?? this.#options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id)
        reject(new Error(`harness: ${method} timed out after ${String(limit)}ms`))
      }, limit)

      this.#pending.set(id, { resolve, reject, timer, method })
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
    })
  }
}

export { NOTIFICATION, type SessionEventNotification }
