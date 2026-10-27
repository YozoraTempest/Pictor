import { createServer, type Server, type Socket } from 'node:net'

import {
  evaluateToolHooks,
  evaluateToolGuards,
  hookOutputOf,
  type ToolGuardContribution,
  type ToolHookContribution,
} from '@vulonlok/plugin-sdk'

/**
 * Where the runtime's guard plugin reaches the app.
 *
 * Handed to the kernel through its profile patch, so the plugin it mounts knows
 * which socket to dial and which token to quote.
 */
export interface GuardEndpoint {
  port: number
  token: string
}

/**
 * The app's end of the tool bridge: guards before a call, hooks after it.
 *
 * Plugin code is ordinary JavaScript that runs in this process, so it cannot be
 * serialised into a kernel's configuration. Each kernel-side plugin is written into that
 * kernel's profile and asks this server over loopback instead: one question per call
 * before it runs (guards, fail closed) and one after it settles (hooks, fail open).
 *
 * Both halves ride one socket because both halves are about the same call, and a second
 * bridge would only be a second token to keep in step.
 */
/** What one call looks like when the app has to decide whether to hold it. */
export interface GuardAsk {
  /** Pictor conversation the call belongs to, when the kernel can name it. */
  session: string | null
  tool: string
  args: unknown
  /**
   * The kernel's own judgement of the call, not a list of tool names Pictor keeps:
   * Pi derives it from the tool's annotations, so a new or plugin tool is covered
   * without teaching this process about it.
   */
  mutating: boolean
}

/** What to put in front of a person, when the call should wait for one. */
export interface GuardAskPrompt {
  tool: string
  reason: string
}

/**
 * Decides whether a call waits for a person.
 *
 * Only asked for a caller that says it can suspend the call (`hold`): the answer is
 * a request to ask, not a verdict Pictor can enforce by itself.
 */
export type GuardAskDecider = (
  context: GuardAsk,
) => Promise<GuardAskPrompt | null> | GuardAskPrompt | null

export class ToolBridgeServer {
  /**
   * The guards to ask, read per call.
   *
   * A function rather than an array because guards are installed while the app runs: a
   * policy that only starts applying after a restart is a policy nobody can rely on.
   */
  readonly #guards: () => readonly ToolGuardContribution[]
  /** What runs after a call, in contribution order; read per call for the same reason. */
  readonly #hooks: () => readonly ToolHookContribution[]
  readonly #token: string
  readonly #ask: GuardAskDecider | null
  /**
   * The services Pictor knows, for a kernel that registers them at runtime.
   *
   * `unknown` on purpose: the bridge forwards this array as JSON and never reads a
   * field, so the shape belongs to whichever kernel asks for it — the extension on
   * the other end of the socket — not to the bridge or to the file that assembles it.
   */
  readonly #providers: (() => Promise<readonly unknown[]>) | null
  #server: Server | null = null
  #endpoint: GuardEndpoint | null = null

  constructor(
    guards: () => readonly ToolGuardContribution[],
    token: string,
    ask: GuardAskDecider | null = null,
    providers: (() => Promise<readonly unknown[]>) | null = null,
    hooks: () => readonly ToolHookContribution[] = () => [],
  ) {
    this.#guards = guards
    this.#hooks = hooks
    this.#token = token
    this.#ask = ask
    this.#providers = providers
  }

  get endpoint(): GuardEndpoint | null {
    return this.#endpoint
  }

  async start(): Promise<GuardEndpoint> {
    if (this.#endpoint !== null) return this.#endpoint

    const server = createServer((socket) => this.#accept(socket))
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      // Loopback only: the runtime is a local child process, and the token keeps
      // another local process from speaking for it.
      server.listen(0, '127.0.0.1', () => {
        server.off('error', reject)
        resolve()
      })
    })
    this.#server = server

    const address = server.address()
    if (address === null || typeof address === 'string') {
      throw new Error('guard bridge has no port')
    }
    this.#endpoint = { port: address.port, token: this.#token }
    return this.#endpoint
  }

  async stop(): Promise<void> {
    const server = this.#server
    this.#server = null
    this.#endpoint = null
    if (server === null) return
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }

  #accept(socket: Socket): void {
    let buffer = ''
    let answered = false

    const reply = (payload: unknown): void => {
      if (answered) return
      answered = true
      socket.end(`${JSON.stringify(payload)}\n`)
    }

    socket.setEncoding('utf8')
    socket.setTimeout(5_000, () => reply({ block: true, reason: '工具守卫桥接超时' }))
    socket.on('error', () => socket.destroy())
    socket.on('data', (chunk: string) => {
      buffer += chunk
      const end = buffer.indexOf('\n')
      if (end === -1) return
      void this.#answer(buffer.slice(0, end), reply)
    })
  }

  async #answer(raw: string, reply: (payload: unknown) => void): Promise<void> {
    let request: unknown
    try {
      request = JSON.parse(raw)
    } catch {
      reply({ block: true, reason: '工具守卫桥接收到无法解析的请求' })
      return
    }

    const record = (request ?? {}) as Record<string, unknown>
    if (record['token'] !== this.#token) {
      reply({ block: true, reason: '工具守卫桥接拒绝了未认证的请求' })
      return
    }

    // One other question rides this socket: the services Pictor knows, for Pi to
    // register. Keys are handed over here rather than written into the extension file,
    // which lives on disk with the profile.
    if (record['kind'] === 'providers') {
      const providers = this.#providers === null ? [] : await this.#providers()
      reply({ providers })
      return
    }

    const tool = typeof record['tool'] === 'string' ? record['tool'] : ''
    const args = record['args'] ?? null

    // After a call: the hooks may say what the model should read next. Failing here is
    // never a refusal — a hook cannot grant or deny, so an empty answer is the honest
    // one and the kernel keeps the result it already has.
    if (record['kind'] === 'after') {
      const output = typeof record['output'] === 'string' ? record['output'] : ''
      const outcome = await evaluateToolHooks(this.#hooks(), {
        tool,
        args,
        session: typeof record['session'] === 'string' ? record['session'] : null,
        ok: record['ok'] !== false,
        output: hookOutputOf(output),
      })
      for (const failure of outcome.failures) console.warn(`[hook] ${failure.reason}`)
      reply({
        ...(outcome.note === undefined ? {} : { note: outcome.note }),
        ...(outcome.fail === undefined ? {} : { fail: outcome.fail }),
      })
      return
    }
    const verdict = await evaluateToolGuards(this.#guards(), { tool, args })
    if (verdict.blocked) {
      reply({ block: true, reason: verdict.reason ?? 'blocked by a tool guard' })
      return
    }

    // A caller that can suspend the call (`hold`) may also be told to ask a person
    // first. One that cannot — dsh's guard plugin — is only ever allowed or blocked,
    // because a pause it cannot perform would read as consent.
    if (record['hold'] === true && this.#ask !== null) {
      const prompt = await this.#ask({
        session: typeof record['session'] === 'string' ? record['session'] : null,
        tool,
        args,
        // No hints from the kernel means "treat it as able to change something",
        // which is the cautious reading and the one Pictor's docs describe.
        mutating: record['mutating'] !== false,
      })
      if (prompt !== null) {
        reply({ block: false, ask: prompt })
        return
      }
    }

    reply({ block: false })
  }
}
