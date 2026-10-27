import { jobOf, planActiveOf, subagentOf, todosOf } from '@vulonlok/kernel-dsh'
import type { ChatEvent, ChatRole } from '@vulonlok/shared'
import type {
  HarnessNotification,
  SessionAssistantStreamFrame,
  SessionFollowFrame,
  SessionWireEvent,
} from '@vulonlok/harness-dsh'

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
 * Keeping the translation here means the UI never had to learn a second vocabulary.
 * This is dsh's half of it: a kernel with a protocol of its own brings its own
 * translation (`kernel/pi-events.ts`) and emits these same events.
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
  /** Arguments streamed so far per `<session>:<callId>`, until the call lands. */
  readonly #partials = new Map<string, string>()
  /**
   * The `plan` command a conversation has issued but not finished.
   *
   * Plan mode is changed by the runtime running its own `plan` command, so between
   * `/plan` and its settlement the mode has not moved yet. Keeping the command id is
   * what lets the window say "switching" instead of drawing the old mode as if nothing
   * had been asked for.
   */
  readonly #planCommands = new Map<string, string>()

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

  /** One live model frame: text becomes the answer, reasoning its own row. */
  #mapStream(sessionId: string, frame: SessionAssistantStreamFrame): ChatEvent[] {
    if (frame.type !== 'chunk') {
      // `start` announces an attempt the durable `turn/start` already opened, and
      // `end` only marks that the committed event below is authoritative.
      return []
    }
    const chunk = frame.chunk
    if (chunk === undefined) return []

    const runId = this.#runId(sessionId)
    // Reasoning arrives over the same channel. Mapping it keeps a long think from
    // looking like a stall: the transcript shows it as its own collapsible row.
    if (chunk.type === 'reasoning-delta') {
      if (typeof chunk.text !== 'string' || chunk.text.length === 0) return []
      return [{ type: 'thinking.delta', sessionId, runId, text: chunk.text }]
    }
    if (chunk.type === 'usage') {
      const usage = chunk.usage as
        { inputTokens?: unknown; outputTokens?: unknown; totalTokens?: unknown } | undefined
      const count = (value: unknown): number | null =>
        typeof value === 'number' && Number.isFinite(value) ? value : null
      const input = count(usage?.inputTokens)
      const output = count(usage?.outputTokens)
      const total =
        count(usage?.totalTokens) ?? (input !== null && output !== null ? input + output : null)
      if (input === null && output === null && total === null) return []
      return [{ type: 'run.usage', sessionId, runId, input, output, total }]
    }
    if (chunk.type === 'tool-call-delta') {
      // The model writes a call's arguments token by token. Showing the row now,
      // with the arguments as far as they got, is what keeps a slow tool call from
      // looking like a stalled turn; the durable `tool/call` completes it.
      const callId = typeof chunk.id === 'string' ? chunk.id : ''
      if (callId.length === 0) return []
      const key = `${sessionId}:${callId}`
      const tool = typeof chunk.name === 'string' ? chunk.name : ''
      if (tool.length > 0) this.#calls.set(key, tool)
      const delta = typeof chunk.argumentsDelta === 'string' ? chunk.argumentsDelta : ''
      const partial = `${this.#partials.get(key) ?? ''}${delta}`
      this.#partials.set(key, partial)
      return [
        {
          type: 'tool.pending',
          sessionId,
          runId,
          callId,
          tool: this.#calls.get(key) ?? 'tool',
          argumentsText: partial,
        },
      ]
    }
    if (chunk.type !== 'text-delta') return []
    if (typeof chunk.text !== 'string' || chunk.text.length === 0) return []

    // Only an answer marks the run as streamed; reasoning must not swallow the
    // committed message below.
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
        // `turn/start` sits right after the prompt, so its sequence is what a
        // fork from the user's question keeps.
        return [
          {
            type: 'run.started',
            sessionId,
            runId,
            ...(typeof event.seq === 'number' ? { seq: event.seq } : {}),
          },
        ]
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
        if (callId.length > 0) {
          this.#calls.set(`${sessionId}:${callId}`, tool)
          // The call is now complete, so the streamed copy is no longer needed.
          this.#partials.delete(`${sessionId}:${callId}`)
        }
        return [
          {
            type: 'tool.started',
            sessionId,
            runId: this.#runId(sessionId),
            tool,
            input: parseArguments(data['arguments']),
            ...(callId.length === 0 ? {} : { callId }),
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
            ...(callId.length === 0 ? {} : { callId }),
          },
        ]
      }

      /**
       * The runtime replaced older turns with a summary.
       *
       * `compaction/prune` is deliberately not surfaced: the tool-result pruner fires
       * per oversized tool output, and a divider for each would bury the transcript.
       * This one is the whole-conversation compaction, which is worth a row.
       */
      /**
       * The agent's task list, as a whole snapshot.
       *
       * `todo_write` is the model's own planning surface; the row it leaves in the
       * transcript is a record of one write, while this event is what the list *is*
       * now. Both are drawn: the row where it happened, the bar where it stands.
       */
      case 'todo/write': {
        const todos = todosOf(data['todos'])
        if (todos === null) return []
        return [{ type: 'todo.updated', sessionId, todos }]
      }

      case 'plan/mode': {
        this.#planCommands.delete(sessionId)
        return [{ type: 'plan.changed', sessionId, active: planActiveOf(data), pending: false }]
      }

      case 'command/run': {
        // Only the runtime's own `plan` command changes the mode; every other command
        // is none of this row's business.
        if (data['name'] !== 'plan') return []
        const commandId = String(data['commandId'] ?? '')
        if (commandId.length > 0) this.#planCommands.set(sessionId, commandId)
        return [{ type: 'plan.changed', sessionId, active: null, pending: true }]
      }

      case 'command/done': {
        const pending = this.#planCommands.get(sessionId)
        if (pending === undefined || pending !== String(data['commandId'] ?? '')) return []
        this.#planCommands.delete(sessionId)
        // A settled command that changed nothing still clears the pending mark; the
        // `plan/mode` event that accompanies a real change sets the mode itself.
        return [{ type: 'plan.changed', sessionId, active: null, pending: false }]
      }

      /**
       * One background job registered or settled.
       *
       * Sent as an upsert per job so the roster is a map, not a transcript: the panel
       * shows what is running now, and a settled job stays visible with its outcome.
       */
      case 'job/registered':
      case 'job/settled': {
        const job = jobOf(data)
        return job === null ? [] : [{ type: 'job.updated', sessionId, job }]
      }

      /**
       * A child agent was published.
       *
       * The runtime reports the delegation as it happens, which is the only moment the
       * window can learn about it: the child's own log belongs to another session, and
       * nothing in the parent's transcript says "I started someone".
       */
      case 'subagent/catalog': {
        const subagent = subagentOf(data)
        return subagent === null ? [] : [{ type: 'subagent.linked', sessionId, subagent }]
      }

      case 'compaction/summary': {
        const saved = data['shadowedTokenCount']
        const summary = data['summary']
        return [
          {
            type: 'run.compacted',
            sessionId,
            savedTokens: typeof saved === 'number' && Number.isFinite(saved) ? saved : null,
            summary: typeof summary === 'string' && summary.length > 0 ? summary : null,
            // dsh does not name a reason on the event; the command or the threshold
            // decided it, and the row does not have to guess which.
            reason: null,
          },
        ]
      }

      case 'llm/retry': {
        // The runtime re-runs a failed model step inside this turn; saying so is
        // better than leaving the turn looking stalled until it recovers or gives up.
        const failure = data['failure'] as { message?: unknown } | null | undefined
        return [
          {
            type: 'run.retrying',
            sessionId,
            runId: this.#runId(sessionId),
            attempt: Number(data['retry'] ?? 1),
            maxAttempts: Number(data['maxRetries'] ?? 1),
            message: typeof failure?.message === 'string' ? failure.message : '',
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
        // A kernel that forks by message reports the question's entry id here: it
        // only exists once the turn is stored, so it cannot arrive with the start.
        const forkId = typeof data['forkId'] === 'string' ? data['forkId'] : undefined
        return [
          {
            type: 'run.finished',
            sessionId,
            runId,
            reason: finishReason(data['reason']),
            ...(detail === undefined ? {} : { message: detail }),
            // `turn/end` closes the turn: a fork after this answer keeps it.
            ...(typeof event.seq === 'number' ? { seq: event.seq } : {}),
            ...(forkId === undefined ? {} : { forkId }),
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
