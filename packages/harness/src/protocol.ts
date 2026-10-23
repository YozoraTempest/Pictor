/**
 * Wire types for the DeepSeek Harness SDK runtime.
 *
 * The runtime is a separate process that speaks newline-delimited JSON-RPC on
 * stdio, so these types are the only thing the two sides share. They are copied
 * rather than imported: Pictor must stay buildable when the runtime is absent or
 * pinned to another version, and the handshake already reports its version.
 */

export const PROTOCOL_VERSION = 1

export interface InitializeParams {
  /** Recorded on every session header; the project directory in Pictor. */
  cwd: string
  /** Provider route the runtime was configured with, e.g. `deepseek-official`. */
  provider: string
  model: string
  reasoningEffort?: string
  maxTokens?: number
}

export interface InitializeResult {
  serverInfo: { name: string; version: string }
}

export type PromptContentBlock =
  | { type: 'text'; text: string }
  | {
      type: 'image'
      data: string
      mimeType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'
    }

export interface PromptParams {
  sessionId: string
  contentBlocks: PromptContentBlock[]
}

export interface SessionParams {
  sessionId: string
}

export interface JsonRpcError {
  code: number
  message: string
}

export interface JsonRpcRequest {
  jsonrpc: '2.0'
  id: number
  method: string
  params?: unknown
}

export interface JsonRpcResponse {
  jsonrpc: '2.0'
  id: number
  result?: unknown
  error?: JsonRpcError
}

export interface JsonRpcNotification {
  jsonrpc: '2.0'
  method: string
  params?: unknown
}

/**
 * Notifications the runtime pushes while work is in flight.
 *
 * The runtime spells them with a dot on the wire (`session.event`) while its
 * source and documentation use a slash (`session/event`). Normalising here keeps
 * that difference in one place instead of in every consumer.
 */
export const NOTIFICATION = {
  sessionEvent: 'session.event',
  sessionCreated: 'session.created',
  turnEnd: 'turn.end',
  agentStatus: 'agent.status',
  agentError: 'agent.error',
  subagentEnd: 'subagent.end',
} as const

export type NotificationName = (typeof NOTIFICATION)[keyof typeof NOTIFICATION]

/** Map either spelling to the wire spelling, so callers can use the docs' form. */
export function normalizeMethod(method: string): string {
  return method.replace(/\//g, '.')
}

export function isJsonRpcResponse(value: unknown): value is JsonRpcResponse {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    typeof (value as { id: unknown }).id === 'number'
  )
}

export function isJsonRpcNotification(value: unknown): value is JsonRpcNotification {
  return (
    typeof value === 'object' &&
    value !== null &&
    !('id' in value) &&
    typeof (value as { method: unknown }).method === 'string'
  )
}

/** A session event as the runtime emits it: the durable log entry, plus its seq. */
export interface SessionEventNotification {
  sessionId?: string
  event?: { type?: string; seq?: number; data?: unknown }
  [key: string]: unknown
}
