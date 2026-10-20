import { mkdirSync } from 'node:fs'

import type { OpenChatInput } from './types.js'

export const PI_API_KEY_ENV = 'PICTOR_PROVIDER_API_KEY'

/**
 * Injects the key only for the duration of one call.
 *
 * Pi resolves `$PICTOR_PROVIDER_API_KEY` on every provider request, so a key set
 * once at session-open time is gone after the first run finishes.
 */
export async function withApiKeyEnv<T>(apiKey: string | null, run: () => Promise<T>): Promise<T> {
  if (apiKey !== null && apiKey.length > 0) {
    process.env[PI_API_KEY_ENV] = apiKey
  }

  try {
    return await run()
  } finally {
    delete process.env[PI_API_KEY_ENV]
  }
}
export const PI_PROVIDER_ID = 'pictor'

export type BridgeEvent =
  | { type: 'delta'; text: string }
  | { type: 'tool.start'; tool: string; input: unknown }
  | { type: 'tool.end'; tool: string; output: string; isError: boolean }
  | { type: 'error'; message: string }

export type ToolInterceptor = (input: {
  tool: string
  args: unknown
}) => Promise<{ block: boolean; reason?: string } | undefined>

export interface OpenedAgent {
  readonly path: string
  prompt(text: string): Promise<void>
  abort(): Promise<void>
  dispose(): void
  setToolInterceptor(interceptor: ToolInterceptor | null): void
}

interface PiSdkModule {
  ModelRuntime: {
    create(options: { modelsPath?: string; refreshOnCreate?: boolean }): Promise<PiModelRuntime>
  }
  SessionManager: {
    create(cwd: string, sessionDir?: string): PiSessionManager
    open(path: string, sessionDir?: string, cwdOverride?: string): PiSessionManager
  }
  createAgentSession(options: Record<string, unknown>): Promise<{ session: PiSession }>
}

interface PiModelRuntime {
  getModel(providerId: string, modelId: string): unknown
}

interface PiSessionManager {
  getSessionFile(): string | undefined
}

interface PiSession {
  prompt(text: string, options?: { streamingBehavior?: 'steer' | 'followUp' }): Promise<void>
  abort(): Promise<void>
  dispose(): void
  subscribe(listener: (event: unknown) => void): () => void
  agent: {
    beforeToolCall?: (
      context: { toolCall: { name: string }; args: unknown },
      signal?: AbortSignal,
    ) => Promise<{ block?: boolean; reason?: string } | undefined>
  }
}

/**
 * Opens a real Pi agent session backed by a JSONL transcript.
 *
 * The key is injected through the environment for the lifetime of the run; it is
 * never written into `models.json`.
 */
export async function openPiChat(
  input: OpenChatInput,
  onEvent: (event: BridgeEvent) => void,
): Promise<OpenedAgent> {
  const sdk = (await import('@earendil-works/pi-coding-agent')) as unknown as PiSdkModule

  mkdirSync(input.sessionDir, { recursive: true })
  mkdirSync(input.agentDir, { recursive: true })

  if (input.apiKey !== null && input.apiKey.length > 0) {
    process.env[PI_API_KEY_ENV] = input.apiKey
  }

  const modelRuntime = await sdk.ModelRuntime.create({
    modelsPath: input.modelsPath,
    refreshOnCreate: false,
  })

  const model = modelRuntime.getModel(PI_PROVIDER_ID, input.modelId)
  if (model === undefined) {
    delete process.env[PI_API_KEY_ENV]
    throw new Error(`model ${input.modelId} is missing; re-save model settings`)
  }

  const sessionManager =
    input.sessionPath !== null && input.sessionPath.length > 0
      ? sdk.SessionManager.open(input.sessionPath, input.sessionDir, input.cwd)
      : sdk.SessionManager.create(input.cwd, input.sessionDir)

  const { session } = await sdk.createAgentSession({
    cwd: input.cwd,
    model,
    modelRuntime,
    agentDir: input.agentDir,
    sessionManager,
    tools: ['read', 'ls', 'grep', 'find', 'write', 'edit', 'bash'],
  })

  let interceptor: ToolInterceptor | null = null

  session.agent.beforeToolCall = async (context) => {
    if (interceptor === null) return undefined
    const decision = await interceptor({ tool: context.toolCall.name, args: context.args })
    if (decision === undefined || decision.block !== true) return undefined
    return { block: true, reason: decision.reason ?? 'blocked by a Pictor plugin' }
  }

  const unsubscribe = session.subscribe((event) => {
    const mapped = mapPiEvent(event)
    if (mapped !== null) onEvent(mapped)
  })

  return {
    path: sessionManager.getSessionFile() ?? '',
    async prompt(text: string): Promise<void> {
      await withApiKeyEnv(input.apiKey, () => session.prompt(text))
    },
    async abort(): Promise<void> {
      await session.abort()
    },
    dispose(): void {
      unsubscribe()
      session.dispose()
      delete process.env[PI_API_KEY_ENV]
    },
    setToolInterceptor(next: ToolInterceptor | null): void {
      interceptor = next
    },
  }
}

export function mapPiEvent(event: unknown): BridgeEvent | null {
  if (typeof event !== 'object' || event === null) return null
  const record = event as Record<string, unknown>

  if (record.type === 'message_update') {
    const assistant = record.assistantMessageEvent
    if (typeof assistant !== 'object' || assistant === null) return null

    const delta = assistant as Record<string, unknown>
    if (delta.type !== 'text_delta' || typeof delta.delta !== 'string') return null
    return { type: 'delta', text: delta.delta }
  }

  if (record.type === 'tool_execution_start') {
    return {
      type: 'tool.start',
      tool: typeof record.toolName === 'string' ? record.toolName : 'tool',
      input: record.args ?? null,
    }
  }

  if (record.type === 'tool_execution_end') {
    return {
      type: 'tool.end',
      tool: typeof record.toolName === 'string' ? record.toolName : 'tool',
      output: stringifyToolResult(record.result),
      isError: record.isError === true,
    }
  }

  return null
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
