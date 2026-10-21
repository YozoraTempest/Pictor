export type { ChatEvent, ChatHistoryPage, ChatMessage, ChatRole } from '@pictor/shared'

/** Attached to a tool call before it executes. Returning `{ block: true }` denies it. */
export type ToolInterceptor = (input: {
  tool: string
  args: unknown
}) => Promise<{ block: boolean; reason?: string } | undefined>

export interface OpenChatInput {
  sessionId: string
  cwd: string
  sessionDir: string
  agentDir: string
  modelsPath: string
  modelId: string
  apiKey: string | null
  /** Existing Pi JSONL path when resuming a session. */
  sessionPath: string | null
}

export interface OpenedChat {
  path: string
}

export interface ChatMessagePageInput {
  path: string
  limit: number
  /** Number of newest messages already loaded. */
  offset: number
}

/**
 * Reads the unified diff a tool reported for the change it made.
 *
 * Pi records it on the result (`details.diff`), both live and in the JSONL, so
 * one reader serves the streaming path and the reload path alike — and the
 * transcript never has to guess by re-diffing call arguments.
 */
export function readToolDiff(details: unknown): string | undefined {
  if (typeof details !== 'object' || details === null) return undefined

  const diff = (details as Record<string, unknown>).diff
  return typeof diff === 'string' && diff.length > 0 ? diff : undefined
}
