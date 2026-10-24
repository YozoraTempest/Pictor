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
  /** Images the user attached to this message; base64, no data URL prefix. */
  images?: ChatImage[]
}

/** One image the user pasted or dropped into the composer. */
export interface ChatImage {
  /** MIME type, e.g. `image/png`. */
  mediaType: string
  /** Base64 payload without the `data:` prefix. */
  data: string
  /** Original file name when the image came from disk. */
  name?: string
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
 * One decision the runtime is waiting for.
 *
 * The runtime asks before an operation its policy does not cover, and holds the
 * tool call until an owner client answers. `eventId` is the handle the answer
 * quotes; there is no session binding on the wire, so the request is shown to
 * whichever conversation is open.
 */
export interface ApprovalRequest {
  eventId: string
  /** Tool that triggered it, when the runtime names one. */
  tool: string | null
  /** Why approval is needed, in the runtime's words. */
  reason: string | null
}
