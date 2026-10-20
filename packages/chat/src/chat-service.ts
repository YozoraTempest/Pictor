import { loadHistoryPage } from './history.js'
import { openPiChat } from './sdk-bridge.js'
import type { BridgeEvent, OpenedAgent, ToolInterceptor } from './sdk-bridge.js'
import type { ChatEvent, ChatHistoryPage, OpenChatInput, OpenedChat } from './types.js'

export interface ChatServiceOptions {
  onEvent: (event: ChatEvent) => void
  /** Injectable for tests; defaults to the real Pi SDK bridge. */
  openAgent?: (input: OpenChatInput, onEvent: (event: BridgeEvent) => void) => Promise<OpenedAgent>
}

/**
 * Owns the single active Pi session for the application.
 *
 * Pi keeps exactly one session per runtime process, so switching Pictor sessions
 * disposes the previous agent before opening the next one.
 */
export class ChatService {
  readonly #onEvent: ChatServiceOptions['onEvent']
  readonly #openAgent: NonNullable<ChatServiceOptions['openAgent']>

  #active: { sessionId: string; agent: OpenedAgent } | null = null
  #interceptor: ToolInterceptor | null = null
  #runCounter = 0

  constructor(options: ChatServiceOptions) {
    this.#onEvent = options.onEvent
    this.#openAgent = options.openAgent ?? openPiChat
  }

  get activeSessionId(): string | null {
    return this.#active?.sessionId ?? null
  }

  /**
   * Installs the guard chain. The interceptor is wrapped so a denied call also
   * reaches the transcript: Pi aborts the tool silently otherwise, and a tool
   * that vanished without a trace is the worst possible outcome for a policy
   * hook.
   */
  setToolInterceptor(interceptor: ToolInterceptor | null): void {
    this.#interceptor = interceptor === null ? null : this.#reporting(interceptor)
    this.#active?.agent.setToolInterceptor(this.#interceptor)
  }

  #reporting(interceptor: ToolInterceptor): ToolInterceptor {
    return async (input) => {
      const decision = await interceptor(input)
      if (decision?.block !== true) return decision

      const sessionId = this.#active?.sessionId
      if (sessionId !== undefined) {
        this.#onEvent({
          type: 'tool.blocked',
          sessionId,
          runId: this.#runId(),
          tool: input.tool,
          reason: decision.reason ?? 'blocked by a tool guard',
        })
      }

      return decision
    }
  }

  async open(input: OpenChatInput): Promise<OpenedChat> {
    await this.close()

    const agent = await this.#openAgent(input, (event) => this.#forward(input.sessionId, event))
    agent.setToolInterceptor(this.#interceptor)
    this.#active = { sessionId: input.sessionId, agent }

    return { path: agent.path }
  }

  async send(prompt: string): Promise<void> {
    const active = this.#active
    if (active === null) throw new Error('no chat session is open')

    const runId = `run-${++this.#runCounter}`
    this.#onEvent({ type: 'run.started', sessionId: active.sessionId, runId })

    try {
      await active.agent.prompt(prompt)
      this.#onEvent({
        type: 'run.finished',
        sessionId: active.sessionId,
        runId,
        reason: 'stop',
      })
    } catch (error) {
      this.#onEvent({
        type: 'run.finished',
        sessionId: active.sessionId,
        runId,
        reason: 'error',
        message: (error as Error).message,
      })
    }
  }

  async stop(): Promise<void> {
    await this.#active?.agent.abort()
  }

  async close(): Promise<void> {
    if (this.#active === null) return
    this.#active.agent.dispose()
    this.#active = null
  }

  async history(path: string, limit: number, offset: number): Promise<ChatHistoryPage> {
    return loadHistoryPage(path, limit, offset)
  }

  #forward(sessionId: string, event: BridgeEvent): void {
    switch (event.type) {
      case 'delta':
        this.#onEvent({ type: 'message.delta', sessionId, runId: this.#runId(), text: event.text })
        return
      case 'tool.start':
        this.#onEvent({
          type: 'tool.started',
          sessionId,
          runId: this.#runId(),
          tool: event.tool,
          input: event.input,
        })
        return
      case 'tool.end':
        this.#onEvent({
          type: 'tool.finished',
          sessionId,
          runId: this.#runId(),
          tool: event.tool,
          output: event.output,
          isError: event.isError,
        })
        return
      case 'error':
        this.#onEvent({
          type: 'run.finished',
          sessionId,
          runId: this.#runId(),
          reason: 'error',
          message: event.message,
        })
    }
  }

  #runId(): string {
    return `run-${this.#runCounter}`
  }
}
