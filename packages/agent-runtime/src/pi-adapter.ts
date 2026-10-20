import type { JsonValue } from '@pictor/shared'

import type { AgentEvent, AgentRequest, AgentRunHandle, AgentRuntime } from './runtime.js'

/** Provider id used inside the generated `models.json`. */
export const PI_PROVIDER_ID = 'pictor'

/** Environment variable Pi interpolates in `models.json`. */
export const PI_API_KEY_ENV = 'PICTOR_PROVIDER_API_KEY'

export interface PiRuntimeConfig {
  /** Model id inside the `pictor` provider. */
  modelId: string
  /** Path to the generated `models.json`. */
  modelsPath: string
  /** Isolated agent directory so Pictor never touches the user's `~/.pi/agent`. */
  agentDir: string
  apiKey: string | null
  /** Working directory for the agent session. */
  workingDirectory: string
}

export interface PiRuntimeOptions {
  loadConfig: () => Promise<PiRuntimeConfig | null>
}

/**
 * The slice of the Pi SDK this adapter uses.
 *
 * Declaring it locally keeps every SDK-specific detail in one file. The SDK is
 * imported lazily so a profile without model configuration can still start.
 */
interface PiSdkModule {
  ModelRuntime: {
    create(options: { modelsPath?: string; refreshOnCreate?: boolean }): Promise<PiModelRuntime>
  }
  createAgentSession(options: PiSessionOptions): Promise<{ session: PiSession }>
}

interface PiModelRuntime {
  getModel(providerId: string, modelId: string): unknown
}

interface PiSessionOptions {
  cwd?: string
  model?: unknown
  modelRuntime?: PiModelRuntime
  agentDir?: string
  noTools?: 'all' | 'builtin'
}

interface PiSession {
  subscribe(listener: (event: unknown) => void): () => void
  prompt(text: string): Promise<void>
  abort(): Promise<void>
  dispose(): void
}

export class PiAgentRuntime implements AgentRuntime {
  readonly id = 'pi'
  readonly #options: PiRuntimeOptions

  constructor(options: PiRuntimeOptions) {
    this.#options = options
  }

  async run(request: AgentRequest, onEvent: (event: AgentEvent) => void): Promise<AgentRunHandle> {
    const config = await this.#options.loadConfig()
    if (config === null) {
      throw new Error('model is not configured; open model settings and save an endpoint first')
    }

    const sdk = (await import('@earendil-works/pi-coding-agent')) as unknown as PiSdkModule
    if (sdk.ModelRuntime?.create === undefined) {
      throw new Error('the installed pi-coding-agent version does not expose ModelRuntime')
    }

    if (config.apiKey !== null && config.apiKey.length > 0) {
      process.env[PI_API_KEY_ENV] = config.apiKey
    }

    const modelRuntime = await sdk.ModelRuntime.create({
      modelsPath: config.modelsPath,
      refreshOnCreate: false,
    })

    const model = modelRuntime.getModel(PI_PROVIDER_ID, config.modelId)
    if (model === undefined) {
      delete process.env[PI_API_KEY_ENV]
      throw new Error(
        `model ${config.modelId} is not present in ${config.modelsPath}; re-save model settings`,
      )
    }

    const { session } = await sdk.createAgentSession({
      cwd: request.workingDirectory,
      model,
      modelRuntime,
      agentDir: config.agentDir,
      // The scaffold's test run must not execute tools against the user's machine.
      noTools: 'all',
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
        delete process.env[PI_API_KEY_ENV]
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
