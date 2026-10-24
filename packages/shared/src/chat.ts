export type ChatRole = 'user' | 'assistant' | 'tool'

export interface ChatMessage {
  /** Stable id derived from the JSONL entry index. */
  id: string
  role: ChatRole
  text: string
  timestamp: number | null
  /**
   * Event boundary a fork from this row keeps (`session/fork` atSeq).
   *
   * A row read from history carries its own event's sequence; a row the window
   * streamed carries the boundary the runtime reported for its turn. Absent means
   * the row is not a place to branch from.
   */
  seq?: number
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
  | { type: 'run.started'; sessionId: string; runId: string; seq?: number }
  | { type: 'message.delta'; sessionId: string; runId: string; text: string }
  | { type: 'thinking.delta'; sessionId: string; runId: string; text: string }
  /** Token accounting for the turn, as the provider reported it. */
  | {
      type: 'run.usage'
      sessionId: string
      runId: string
      input: number | null
      output: number | null
      total: number | null
    }
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
      /** Sequence of `turn/end`: the boundary a fork after this turn keeps. */
      seq?: number
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

/** One answer a model offered for a question it asked. */
export interface ChatQuestionOption {
  label: string
  description?: string
}

/**
 * One question the model asked through `ask_user_question`.
 *
 * The runtime holds the tool call until an answer arrives, so this is not a
 * transcript row: it is a prompt the window has to settle, like an approval.
 */
export interface ChatQuestion {
  id: string
  question: string
  /** Short label the model wants above the question. */
  header?: string
  /** Context the question is about, when the model attached any. */
  detail?: string
  /** Offered answers; absent when the model wants free text. */
  options?: ChatQuestionOption[]
  multiSelect?: boolean
}

/** A batch of questions one tool call is waiting on. */
export interface ChatQuestionRequest {
  eventId: string
  questions: ChatQuestion[]
}

/**
 * One settled answer.
 *
 * `selected` holds the labels of the options picked; `custom` is the text typed
 * instead of (or beside) them. Both empty is a deliberate "no answer".
 */
export interface ChatAnswer {
  id: string
  selected: string[]
  custom?: string
}
