/**
 * Session transport types for the HTTP + WebSocket runtime.
 *
 * The SDK transport speaks JSON-RPC on stdio and the runtime answered with whole
 * messages. The web profile instead exposes a Typert Remote surface: unary
 * methods over `POST /api/<endpoint>` and long-lived streams over one WebSocket.
 * Streaming lives on the stream side, which is why these types exist separately
 * from `protocol.ts`.
 *
 * Shapes are copied from `@deepseek-ai/dsh-api-session-controller`; Pictor stays
 * buildable when the runtime is absent or pinned elsewhere.
 */

/** Identity selecting an ordinary session or one direct subagent child. */
export type SessionAddress =
  | { kind: 'session'; sessionId: string }
  | {
      kind: 'subagent'
      parentSessionId: string
      childSessionId: string
      mode: 'one-shot' | 'continuable' | 'unknown'
    }

export interface SessionCreateRequest {
  /** Workspace the session joins; exclusive with `cwd`. */
  workspaceId?: string
  /** Directory the session owns when no workspace is named. */
  cwd?: string
  /** Reuses a blank session already stored under this id, otherwise creates it. */
  sessionId?: string
  agentPreset?: string
}

export interface SessionCreateValue {
  sessionId: string
  agentPreset?: string
}

export type PromptContentPart =
  { type: 'text'; text: string } | { type: 'image'; mediaType: string; data: string; name?: string }

export interface SessionPromptRequest {
  requestId: string
  sessionId: string
  mode: 'queue' | 'steer'
  content: PromptContentPart[]
  clientTimeZone?: string
}

export interface SessionPromptValue {
  accepted: true
}

export interface SessionCancelRequest {
  sessionId: string
}

/** One token from the model stream, as the runtime forwards it. */
export type StreamChunk =
  | { type: 'block-start'; index: number; blockType?: string }
  | { type: 'text-delta'; index: number; text: string }
  | { type: 'reasoning-delta'; index: number; text: string }
  | { type: 'tool-call-delta'; index: number; id: string; name?: string; argumentsDelta: string }
  | { type: 'block-end'; index: number; block?: unknown }
  | { type: 'usage'; usage?: unknown }
  | { type: 'finish'; reason?: unknown; replayState?: unknown }

/**
 * One assistant stream frame.
 *
 * `start` opens an attempt, `chunk` carries a `StreamChunk` each time the model
 * produces one, and `end` commits the turn: its `outcome.seq` names the durable
 * event the stream became, which is how a live delta is later matched against
 * the stored message instead of being appended twice.
 */
export type SessionAssistantStreamFrame =
  | {
      type: 'start'
      attemptId: string
      revision: number
      startedAfterSeq: number
      turn: number
      step: number
    }
  | {
      type: 'chunk'
      attemptId: string
      revision: number
      index: number
      time: number
      chunk: StreamChunk
    }
  | {
      type: 'end'
      attemptId: string
      revision: number
      index: number
      outcome:
        | { kind: 'committed'; eventType: 'assistant/message' | 'assistant/attempt'; seq: number }
        | { kind: 'abandoned' }
    }

/** One durable log entry as the wire carries it. */
export interface SessionWireEvent {
  type: string
  seq: number
  time: number
  data: unknown
  ignorable?: true
  sourceEventSeqs?: unknown
  surfaceOp?: unknown
}

export interface SessionWireHeader {
  version: number
  id: string
  createdAt: number
  cwd?: string
  agentPreset?: string
}

/** One contiguous backwards page of a session log. */
export interface SessionPage {
  records: readonly { type: 'event'; event: SessionWireEvent }[]
  hasMore: boolean
}

export interface SessionPageRequest {
  address: SessionAddress
  /** Inclusive log cut obtained from the corresponding follow opening frame. */
  throughSeq: number
  beforeSeq?: number
  maxMessages?: number
}

export interface SessionFollowRequest {
  address: SessionAddress
  maxMessages?: number
  /** Opt into live model deltas; without it the stream is durable events only. */
  assistantStream?: true
}

/**
 * Every item a follow stream carries.
 *
 * The opening `snapshot` is the complete history cut plus the `cursor` it stops
 * at; afterwards durable events arrive in order with no gaps, so a reconnect is
 * "take a new snapshot" rather than "resume from a cursor".
 */
export type SessionFollowFrame =
  | {
      type: 'snapshot'
      header: SessionWireHeader
      cursor: number
      records: readonly { type: 'event'; event: SessionWireEvent }[]
      hasMore: boolean
      projections?: unknown
      assistantStream?: unknown
    }
  | { type: 'event'; event: SessionWireEvent }
  | { type: 'assistant-stream'; frame: SessionAssistantStreamFrame }

/** Rare operations the runtime exposes for one session. */
export interface SessionForkRequest {
  sessionId: string
  /**
   * Inclusive event boundary to copy. Omitted, the runtime picks the latest
   * completed turn, which is what a user means by "branch from here".
   */
  atSeq?: number
}

export interface SessionForkValue {
  /** Identity of the new session that inherited the prefix. */
  sessionId: string
}
