import type { ChatEvent, ChatRole } from '@pictor/shared'
import type {
  HarnessNotification,
  SessionAssistantStreamFrame,
  SessionFollowFrame,
  SessionWireEvent,
} from '@pictor/harness'

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
  // `completed` and `forked` both leave the turn usable; `aborted` and
  // `interrupted` are the two ways a turn stops early under the user's control.
  if (kind === 'completed' || kind === 'forked') return 'stop'
  if (kind === 'aborted' || kind === 'interrupted') return 'cancelled'
  return 'error'
}

/** Tool argument payloads arrive as JSON text; keep them readable either way. */
function parseArguments(value: unknown): unknown {
  if (typeof value !== 'string') return value ?? null
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

/**
 * Translates runtime traffic into the events the transcript already renders.
 *
 * The runtime speaks in durable session events (`turn/start`, `assistant/message`,
 * `turn/end`) plus a live model stream; the renderer speaks in runs and deltas.
 * Keeping the translation here means the UI did not have to learn a second
 * vocabulary, and swapping the runtime again would only change this file.
 *
 * Streaming produces one subtlety: the live deltas and the committed
 * `assistant/message` describe the same text. Whichever arrives first wins — a
 * streamed attempt is remembered per run, so the committed copy is dropped
 * instead of being appended a second time.
 */
export class HarnessChatBridge {
  /** Last turn seen per session, so each run has a stable id. */
  readonly #runs = new Map<string, string>()
  /** Runs whose answer already arrived as live deltas. */
  readonly #streamed = new Set<string>()
  /** Tool name per `<session>:<callId>`; a result carries only the call id. */
  readonly #calls = new Map<string, string>()

  /** Map one notification to renderer events; unknown notifications map to none. */
  map(notification: HarnessNotification): ChatEvent[] {
    if (notification.method === 'session.follow') {
      return this.#mapFollow(notification.params)
    }

    const params = (notification.params ?? {}) as {
      sessionId?: unknown
      event?: SessionWireEvent
      message?: unknown
    }
    const sessionId = typeof params.sessionId === 'string' ? params.sessionId : null
    if (sessionId === null) return []

    if (notification.method === 'agent.error') {
      const runId = this.#runId(sessionId)
      this.#runs.delete(sessionId)
      this.#streamed.delete(runId)
      return [
        {
          type: 'run.finished',
          sessionId,
          runId,
          reason: 'error',
          message: String(params.message ?? ''),
        },
      ]
    }

    if (notification.method !== 'session.event') return []
    if (params.event === undefined) return []
    return this.#mapEvent(sessionId, params.event)
  }

  /** One frame of the live follow stream. */
  #mapFollow(params: unknown): ChatEvent[] {
    if (typeof params !== 'object' || params === null) return []
    const { sessionId, frame } = params as { sessionId?: unknown; frame?: unknown }
    if (typeof sessionId !== 'string' || typeof frame !== 'object' || frame === null) return []

    const typed = frame as SessionFollowFrame
    switch (typed.type) {
      case 'snapshot': {
        // The opening window is history and is not replayed into the transcript,
        // but it can contain the turn that is already running: remembering that
        // turn keeps the run id of the deltas that follow stable.
        for (const record of typed.records) {
          if (record.type !== 'event') continue
          const event = record.event
          if (event.type === 'turn/start') {
            const turn = (event.data as { turn?: unknown } | null)?.turn
            if (typeof turn === 'number') this.#runs.set(sessionId, `t${String(turn)}`)
            else this.#runs.delete(sessionId)
          } else if (event.type === 'turn/end') {
            this.#runs.delete(sessionId)
          }
        }
        return []
      }
      case 'assistant-stream':
        return this.#mapStream(sessionId, typed.frame)
      case 'event':
        return this.#mapEvent(sessionId, typed.event)
      default:
        return []
    }
  }

  /** One live model frame: only text deltas reach the transcript. */
  #mapStream(sessionId: string, frame: SessionAssistantStreamFrame): ChatEvent[] {
    if (frame.type !== 'chunk') {
      // `start` announces an attempt the durable `turn/start` already opened, and
      // `end` only marks that the committed event below is authoritative.
      return []
    }
    const chunk = frame.chunk
    if (chunk?.type !== 'text-delta' || typeof chunk.text !== 'string') return []
    if (chunk.text.length === 0) return []

    const runId = this.#runId(sessionId)
    this.#streamed.add(runId)
    return [{ type: 'message.delta', sessionId, runId, text: chunk.text }]
  }

  /** One durable session event. */
  #mapEvent(sessionId: string, event: SessionWireEvent): ChatEvent[] {
    if (typeof event.type !== 'string') return []
    const data = (event.data ?? {}) as Record<string, unknown>

    switch (event.type) {
      case 'turn/start': {
        const runId = `t${String(data['turn'] ?? 0)}`
        this.#runs.set(sessionId, runId)
        this.#streamed.delete(runId)
        return [{ type: 'run.started', sessionId, runId }]
      }

      case 'assistant/message': {
        const text = textOf(data['message'])
        if (text.length === 0) return []
        const runId = this.#runId(sessionId)
        // A streamed attempt already showed this text token by token.
        if (this.#streamed.delete(runId)) return []
        return [{ type: 'message.delta', sessionId, runId, text }]
      }

      case 'tool/call': {
        const tool = String(data['name'] ?? 'tool')
        const callId = typeof data['callId'] === 'string' ? data['callId'] : ''
        if (callId.length > 0) this.#calls.set(`${sessionId}:${callId}`, tool)
        return [
          {
            type: 'tool.started',
            sessionId,
            runId: this.#runId(sessionId),
            tool,
            input: parseArguments(data['arguments']),
          },
        ]
      }

      case 'tool/result': {
        // The result names the call, not the tool: the name comes from the call
        // that opened it, which also keeps parallel calls apart.
        const message = (data['message'] ?? {}) as {
          toolCallId?: unknown
          isError?: unknown
          content?: unknown
        }
        const callId = typeof message.toolCallId === 'string' ? message.toolCallId : ''
        const key = `${sessionId}:${callId}`
        const tool = this.#calls.get(key) ?? 'tool'
        this.#calls.delete(key)
        return [
          {
            type: 'tool.finished',
            sessionId,
            runId: this.#runId(sessionId),
            tool,
            output: textOf({ content: message.content }),
            isError: message.isError === true || data['error'] !== undefined,
          },
        ]
      }

      case 'turn/end': {
        const runId = this.#runId(sessionId)
        this.#runs.delete(sessionId)
        this.#streamed.delete(runId)
        const reason = data['reason'] as
          { message?: unknown; error?: { message?: unknown } } | null | undefined
        // A failed turn explains itself under `reason.error`; a cancelled one may
        // carry a plain `reason.message`.
        const detail =
          typeof reason?.message === 'string'
            ? reason.message
            : typeof reason?.error?.message === 'string'
              ? reason.error.message
              : undefined
        return [
          {
            type: 'run.finished',
            sessionId,
            runId,
            reason: finishReason(data['reason']),
            ...(detail === undefined ? {} : { message: detail }),
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
