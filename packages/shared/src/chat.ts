export type ChatRole = 'user' | 'assistant' | 'tool'

export interface ChatMessage {
  /** Stable id derived from the JSONL entry index. */
  id: string
  role: ChatRole
  text: string
  timestamp: number | null
  toolName?: string
  isError?: boolean
  /** True when a tool guard denied the call; the text holds the reason. */
  blocked?: boolean
  /** Assistant content kind; defaults to the visible answer. */
  kind?: 'text' | 'thinking'
  /** Raw arguments a tool call was given; only tools carry this. */
  input?: unknown
  /**
   * Unified diff a tool reported for its change (`edit`).
   *
   * The tool computed it from the real file, so it is more trustworthy than
   * diffing the call arguments, and it survives a reload via the JSONL entry.
   */
  diff?: string
}

export interface ChatHistoryPage {
  messages: ChatMessage[]
  /** Offset to pass to the next history call to load older messages. */
  nextOffset: number
  hasMore: boolean
}

/** Events forwarded from the main process to the renderer. */
export type ChatEvent =
  | { type: 'run.started'; sessionId: string; runId: string }
  | { type: 'message.delta'; sessionId: string; runId: string; text: string }
  | { type: 'thinking.delta'; sessionId: string; runId: string; text: string }
  | { type: 'tool.started'; sessionId: string; runId: string; tool: string; input: unknown }
  | {
      type: 'tool.finished'
      sessionId: string
      runId: string
      tool: string
      output: string
      isError: boolean
      /** Unified diff the tool reported, when it made one. */
      diff?: string
    }
  | {
      type: 'tool.blocked'
      sessionId: string
      runId: string
      tool: string
      reason: string
    }
  | {
      type: 'run.finished'
      sessionId: string
      runId: string
      reason: 'stop' | 'cancelled' | 'error'
      message?: string
    }
  | {
      /** The runtime is re-running a failed model step inside the same turn. */
      type: 'run.retrying'
      sessionId: string
      runId: string
      attempt: number
      maxAttempts: number
      message: string
    }

/**
 * Marker prepended to a guard's reason before it is handed to the agent.
 *
 * The JSONL is written by Pi and only records "this tool failed", so a denied
 * call would look like an ordinary failure after a reload. Carrying a stable
 * marker in the reason is what lets the projection tell the two apart — and it
 * also tells the agent that a policy refused the call rather than the command
 * being wrong.
 */
export const BLOCKED_REASON_PREFIX = '[pictor:blocked] '

export function isBlockedReason(text: string): boolean {
  return text.startsWith(BLOCKED_REASON_PREFIX)
}

/** Removes the marker for display; a plain reason is returned unchanged. */
export function stripBlockedPrefix(text: string): string {
  return text.startsWith(BLOCKED_REASON_PREFIX) ? text.slice(BLOCKED_REASON_PREFIX.length) : text
}
