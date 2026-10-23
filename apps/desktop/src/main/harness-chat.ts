import type { ChatEvent, ChatRole } from '@pictor/shared'
import type { HarnessNotification } from '@pictor/harness'

/** The text of one message, from its content blocks. */
function textOf(message: unknown): string {
  if (typeof message !== 'object' || message === null) return ''
  const content = (message as { content?: unknown }).content
  if (!Array.isArray(content)) return ''

  return content
    .flatMap((block): string[] => {
      if (typeof block !== 'object' || block === null) return []
      const entry = block as { type?: unknown; text?: unknown }
      return entry.type === 'text' && typeof entry.text === 'string' ? [entry.text] : []
    })
    .join('')
}

function roleOf(message: unknown): ChatRole {
  const role = (message as { role?: unknown } | null)?.role
  return role === 'assistant' || role === 'tool' || role === 'user' ? role : 'assistant'
}

/** Turn-end reasons the runtime reports, mapped onto the renderer's vocabulary. */
function finishReason(reason: unknown): 'stop' | 'cancelled' | 'error' {
  const kind = (reason as { kind?: unknown } | null)?.kind
  if (kind === 'completed') return 'stop'
  if (kind === 'cancelled' || kind === 'aborted') return 'cancelled'
  return 'error'
}

interface SessionEvent {
  type?: string
  seq?: number
  data?: Record<string, unknown>
}

/**
 * Translates runtime notifications into the events the transcript already renders.
 *
 * The runtime speaks in durable session events (`turn/start`, `assistant/message`,
 * `turn/end`); the renderer speaks in runs and deltas. Keeping the translation
 * here means the UI did not have to learn a second vocabulary, and swapping the
 * runtime again would only change this file.
 *
 * One asymmetry is deliberate: the SDK pushes whole assistant messages, not token
 * deltas, so `message.delta` carries the complete text once instead of streaming.
 */
export class HarnessChatBridge {
  /** Last turn seen per session, so each run has a stable id. */
  readonly #runs = new Map<string, string>()

  /** Map one notification to renderer events; unknown notifications map to none. */
  map(notification: HarnessNotification): ChatEvent[] {
    const params = (notification.params ?? {}) as {
      sessionId?: unknown
      event?: SessionEvent
      status?: unknown
    }
    const sessionId = typeof params.sessionId === 'string' ? params.sessionId : null
    if (sessionId === null) return []

    if (notification.method === 'agent.error') {
      return [
        {
          type: 'run.finished',
          sessionId,
          runId: this.#runId(sessionId),
          reason: 'error',
          message: String((notification.params as { message?: unknown } | null)?.message ?? ''),
        },
      ]
    }

    if (notification.method !== 'session.event') return []

    const event = params.event
    if (event?.type === undefined) return []
    const data = event.data ?? {}

    switch (event.type) {
      case 'turn/start': {
        const runId = `t${String(data['turn'] ?? 0)}`
        this.#runs.set(sessionId, runId)
        return [{ type: 'run.started', sessionId, runId }]
      }

      case 'assistant/message': {
        const text = textOf(data['message'])
        if (text.length === 0) return []
        return [
          {
            type: 'message.delta',
            sessionId,
            runId: this.#runId(sessionId),
            text,
          },
        ]
      }

      case 'tool/call': {
        const tool = String(data['name'] ?? data['tool'] ?? 'tool')
        return [
          {
            type: 'tool.started',
            sessionId,
            runId: this.#runId(sessionId),
            tool,
            input: data['arguments'] ?? data['input'] ?? null,
          },
        ]
      }

      case 'tool/result': {
        const tool = String(data['name'] ?? data['tool'] ?? 'tool')
        const isError = data['isError'] === true
        return [
          {
            type: 'tool.finished',
            sessionId,
            runId: this.#runId(sessionId),
            tool,
            output:
              typeof data['output'] === 'string'
                ? data['output']
                : JSON.stringify(data['result'] ?? ''),
            isError,
          },
        ]
      }

      case 'turn/end': {
        const runId = this.#runId(sessionId)
        this.#runs.delete(sessionId)
        return [
          {
            type: 'run.finished',
            sessionId,
            runId,
            reason: finishReason(data['reason']),
            ...(typeof (data['reason'] as { message?: unknown } | null)?.message === 'string'
              ? { message: (data['reason'] as { message: string }).message }
              : {}),
          },
        ]
      }

      default:
        return []
    }
  }

  /** Role a message event describes, exposed for callers that project history. */
  static roleOf = roleOf

  #runId(sessionId: string): string {
    return this.#runs.get(sessionId) ?? 't0'
  }
}
