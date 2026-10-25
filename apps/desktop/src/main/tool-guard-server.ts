import { createServer, type Server, type Socket } from 'node:net'

import { evaluateToolGuards, type ToolGuardContribution } from '@pictor/plugin-sdk'

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
 * Answers the runtime's guard plugin over a loopback socket.
 *
 * Plugin guards are ordinary JavaScript that runs in this process, so they cannot
 * be serialised into the kernel's configuration. The kernel-side plugin therefore
 * asks this server one question per tool call and applies the answer.
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

export class ToolGuardServer {
  readonly #guards: readonly ToolGuardContribution[]
  readonly #token: string
  readonly #ask: GuardAskDecider | null
  #server: Server | null = null
  #endpoint: GuardEndpoint | null = null

  constructor(
    guards: readonly ToolGuardContribution[],
    token: string,
    ask: GuardAskDecider | null = null,
  ) {
    this.#guards = guards
    this.#token = token
    this.#ask = ask
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

    const tool = typeof record['tool'] === 'string' ? record['tool'] : ''
    const args = record['args'] ?? null
    const verdict = await evaluateToolGuards(this.#guards, { tool, args })
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
