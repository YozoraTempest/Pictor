import type { FrameAnswer } from '../../../../shared/bridge.js'

/**
 * The message channel a frame and the window share.
 *
 * A frame is a sandboxed iframe: no same-origin, no Node, no network. What it does have is
 * `postMessage`, and this is the whole grammar of it — two messages in, two kinds out. The
 * parser is a pure function on purpose, because it is the one place untrusted input from
 * plugin code becomes something the window acts on.
 *
 * Nothing here carries a function, a component or a handler: a frame asks, the plugin in
 * the main process answers, and the window only carries the answer across.
 */

/** The longest `action` a frame may name, and the longest value it may carry. */
export const FRAME_MESSAGE_LIMITS = {
  action: 200,
  value: 2_000,
} as const

export type FrameMessage =
  { type: 'ready' } | { type: 'request'; id: number; action: string; value?: string }

/**
 * Reads one message from a frame, or nothing.
 *
 * `null` rather than a throw: a frame runs a plugin's own code, so anything at all can
 * arrive here — a page's own message, a typo, a future shape from a newer plugin. Returning
 * nothing lets the caller ignore it, which is the one response that cannot go wrong.
 */
export function readFrameMessage(value: unknown): FrameMessage | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  // The marker keeps a frame's own messages from being read as ours, which matters because
  // both sides share one channel.
  if (record['__pictor'] !== true) return null

  if (record['type'] === 'ready') return { type: 'ready' }
  if (record['type'] !== 'request') return null

  const id = record['id']
  if (typeof id !== 'number' || !Number.isSafeInteger(id) || id < 0) return null

  const action = record['action']
  if (typeof action !== 'string' || action.length === 0) return null
  if (action.length > FRAME_MESSAGE_LIMITS.action) return null

  const carried = record['value']
  if (carried === undefined) return { type: 'request', id, action }
  if (typeof carried !== 'string' || carried.length > FRAME_MESSAGE_LIMITS.value) return null
  return { type: 'request', id, action, value: carried }
}

/**
 * What the host tells a frame about the window it landed in.
 *
 * The plugin's own id is absent: the frame's files already came from that plugin, and a
 * question about anything else goes through `request`, where the id is supplied for it.
 */
export interface FrameContext {
  sessionId: string | null
  /** The app's own colours, so a frame can match without shipping a palette. */
  theme: Record<string, string>
}

export function frameInit(context: FrameContext): unknown {
  return { __pictor: true, type: 'init', context }
}

/** One answer, addressed to the request that asked for it. */
export function frameAnswer(id: number, answer: FrameAnswer): unknown {
  return answer.ok
    ? { __pictor: true, type: 'answer', id, ok: true, data: answer.data }
    : { __pictor: true, type: 'answer', id, ok: false, error: answer.error }
}
