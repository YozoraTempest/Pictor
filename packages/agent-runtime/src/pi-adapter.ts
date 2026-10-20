import type { JsonValue } from '@pictor/shared'

import type { AgentEvent, AgentRequest, AgentRunHandle, AgentRuntime } from './runtime.js'

/**
 * Configuration for the Pi-backed runtime.
 *
 * It is read from the profile settings, never from the renderer, so the API key
 * cannot leak into the UI or a session transcript.
 */
export interface PiRuntimeConfig {
  baseUrl: string
  modelId: string
  apiKey?: string
  protocol?: 'chat-completions' | 'responses'
  workingDirectory: string
}

export interface PiRuntimeOptions {
  loadConfig: () => Promise<PiRuntimeConfig | null>
}

/**
 * The slice of the Pi SDK this adapter uses.
 *
 * Declaring it locally keeps every SDK-specific detail in one file and lets the
 * adapter compile against a pinned-but-evolving upstream package. `createAgentSession`
 * is checked at runtime before use.
 */
interface PiSdkModule {
  createAgentSession(options: PiSessionOptions): Promise<{ session: PiSession }>
}

interface PiSessionOptions {
  cwd?: string
  model?: unknown
}

interface PiSession {
  subscribe(listener: (event: unknown) => void): () => void
  prompt(text: string): Promise<void>
  abort(): Promise<void>
  dispose(): void
}

/**
 * Thin adapter over the Pi agent SDK.
 *
 * The SDK is imported lazily so a profile without model configuration can still
 * start, list projects and run plugins.
 */
export class PiAgentRuntime implements AgentRuntime {
  readonly id = 'pi'
  readonly #options: PiRuntimeOptions

  constructor(options: PiRuntimeOptions) {
    this.#options = options
  }

  async run(request: AgentRequest, onEvent: (event: AgentEvent) => void): Promise<AgentRunHandle> {
    const config = await this.#options.loadConfig()
    if (config === null) {
      throw new Error('model is not configured; save an OpenAI-compatible endpoint first')
    }

    const sdk = (await import('@earendil-works/pi-coding-agent')) as unknown as PiSdkModule
    if (typeof sdk.createAgentSession !== 'function') {
      throw new Error('the installed pi-coding-agent version does not expose createAgentSession')
    }

    const { session } = await sdk.createAgentSession({
      cwd: request.workingDirectory,
      model: toPiModel(config),
    })

    let cancelled = false

    const unsubscribe = session.subscribe((event) => {
      const mapped = mapPiEvent(request.runId, event)
      if (mapped !== null) onEvent(mapped)
    })

    onEvent({ type: 'run.started', runId: request.runId })

    void (async () => {
      try {
        await session.prompt(request.prompt)
        onEvent({
          type: 'run.finished',
          runId: request.runId,
          reason: cancelled ? 'cancelled' : 'stop',
        })
      } catch (error) {
        onEvent({
          type: 'run.finished',
          runId: request.runId,
          reason: cancelled ? 'cancelled' : 'error',
          message: (error as Error).message,
        })
      } finally {
        unsubscribe()
        session.dispose()
      }
    })()

    return {
      runId: request.runId,
      cancel(): void {
        cancelled = true
        void session.abort()
      },
    }
  }
}

/**
 * Maps the app configuration onto the model descriptor Pi expects.
 *
 * The upstream `Model` type carries catalog fields this scaffold does not have
 * yet, so the object is assembled from the documented shape and passed through
 * the adapter boundary rather than mirroring the full type.
 */
export function toPiModel(config: PiRuntimeConfig): Record<string, unknown> {
  const api = config.protocol === 'responses' ? 'openai-responses' : 'openai-completions'

  return {
    id: config.modelId,
    name: config.modelId,
    api,
    provider: 'pictor-openai-compatible',
    baseUrl: config.baseUrl,
    reasoning: false,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 8_192,
    ...(config.apiKey === undefined ? {} : { apiKey: config.apiKey }),
  }
}

/** Projects one Pi agent event onto the Pictor event union. */
export function mapPiEvent(runId: string, event: unknown): AgentEvent | null {
  if (typeof event !== 'object' || event === null) return null

  const record = event as Record<string, unknown>

  switch (record.type) {
    case 'message_update': {
      const assistantEvent = record.assistantMessageEvent
      if (typeof assistantEvent !== 'object' || assistantEvent === null) return null

      const delta = assistantEvent as Record<string, unknown>
      if (delta.type !== 'text_delta' || typeof delta.delta !== 'string') return null

      return { type: 'message.delta', runId, text: delta.delta }
    }

    case 'tool_execution_start':
      return {
        type: 'tool.started',
        runId,
        tool: typeof record.toolName === 'string' ? record.toolName : 'tool',
        input: (record.args ?? null) as JsonValue,
      }

    case 'tool_execution_end':
      return {
        type: 'tool.finished',
        runId,
        tool: typeof record.toolName === 'string' ? record.toolName : 'tool',
        output: stringifyToolResult(record.result),
        isError: record.isError === true,
      }

    default:
      return null
  }
}

function stringifyToolResult(result: unknown): string {
  if (typeof result === 'string') return result
  if (typeof result !== 'object' || result === null) return ''

  const content = (result as Record<string, unknown>).content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''

  return content
    .map((block) => {
      if (typeof block === 'string') return block
      if (typeof block === 'object' && block !== null) {
        const text = (block as Record<string, unknown>).text
        if (typeof text === 'string') return text
      }
      return ''
    })
    .join('\n')
    .trim()
}
