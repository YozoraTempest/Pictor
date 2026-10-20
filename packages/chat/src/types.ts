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
