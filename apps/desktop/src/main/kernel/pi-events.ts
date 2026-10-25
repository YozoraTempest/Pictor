/**
 * Turning Pi's event stream into the frames the window already understands.
 *
 * Pi speaks in `message_update` / `tool_execution_*` / `turn_end` records — the
 * same vocabulary in JSON and RPC mode. Pictor speaks in durable events
 * (`turn/start`, `tool/call`, `turn/end`) plus live stream chunks. Keeping the
 * translation here, away from processes and sockets, is what makes it testable:
 * every mistake in this file is invisible until a real turn runs — a frame nested
 * the wrong way is dropped by the bridge, and a run that closes without an answer
 * looks like a blank turn.
 *
 * One Pictor turn is one prompt, not one Pi turn: Pi opens a turn per model step,
 * and re-keying the stream mid-run would restart the answer bubble halfway through
 * an answer. So `turn/start` is the driver's, and this class only fills the turn.
 */

/** One thing to hand the main process for this session. */
export type PiFrame =
  { kind: 'event'; type: string; data: unknown } | { kind: 'chunk'; chunk: Record<string, unknown> }

export interface PiEventRead {
  frames: PiFrame[]
  /** Set when the record announced the session id Pi is writing under. */
  sessionId?: string
}

/** The visible text of a content block list; thinking and images are excluded. */
export function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .flatMap((block): string[] => {
      if (typeof block !== 'object' || block === null) return []
      const entry = block as { type?: unknown; text?: unknown }
      return entry.type === 'text' && typeof entry.text === 'string' ? [entry.text] : []
    })
    .join('')
}

function contentOf(record: Record<string, unknown>): { content?: unknown } {
  const message = record['message']
  return typeof message === 'object' && message !== null ? (message as { content?: unknown }) : {}
}

export class PiTranslator {
  /** Final text of the last model step, as the fallback for a lost stream. */
  #answer = ''
  /** Whether this turn produced anything readable as an answer or an action. */
  #produced = false
  /** Whether the model reasoned at all, which is not an answer by itself. */
  #thought = false
  /** Why Pi said the run failed, if it did. */
  #failure: string | null = null
  /** True once the user asked for this turn to stop. */
  #cancelled = false

  /** Marks the turn as user-cancelled; the closing frame then reads "aborted". */
  cancel(): void {
    this.#cancelled = true
  }

  /** One Pi record; the frames it produces, and any session id it announced. */
  push(record: Record<string, unknown>): PiEventRead {
    const type = typeof record['type'] === 'string' ? record['type'] : ''

    if (type === 'session') {
      const id = typeof record['id'] === 'string' ? record['id'] : null
      return { frames: [], ...(id === null ? {} : { sessionId: id }) }
    }

    if (type === 'message_update') {
      const inner = (record['assistantMessageEvent'] ?? {}) as Record<string, unknown>
      const kind = typeof inner['type'] === 'string' ? inner['type'] : ''
      const delta = typeof inner['delta'] === 'string' ? inner['delta'] : ''
      if (delta.length === 0) return { frames: [] }
      if (kind !== 'text_delta' && kind !== 'thinking_delta') return { frames: [] }
      // Thinking is what led to the answer, not the answer: a turn that stops after
      // reasoning still owes the reader one, and saying so beats a blank bubble.
      if (kind === 'text_delta') this.#produced = true
      else this.#thought = true
      return {
        frames: [
          {
            kind: 'chunk',
            chunk: {
              type: kind === 'text_delta' ? 'text-delta' : 'reasoning-delta',
              text: delta,
            },
          },
        ],
      }
    }

    if (type === 'tool_execution_start') {
      this.#produced = true
      return {
        frames: [
          {
            kind: 'event',
            type: 'tool/call',
            data: {
              name: typeof record['toolName'] === 'string' ? record['toolName'] : 'tool',
              callId: typeof record['toolCallId'] === 'string' ? record['toolCallId'] : '',
              arguments: JSON.stringify(record['args'] ?? {}),
            },
          },
        ],
      }
    }

    if (type === 'tool_execution_end') {
      const result = (record['result'] ?? {}) as { content?: unknown }
      return {
        frames: [
          {
            kind: 'event',
            type: 'tool/result',
            data: {
              message: {
                toolCallId: record['toolCallId'],
                isError: record['isError'] === true,
                content: [{ type: 'text', text: textOf(result.content) }],
              },
            },
          },
        ],
      }
    }

    if (type === 'turn_end') {
      const content = contentOf(record)
      const answer = textOf(content.content)
      if (answer.length > 0) {
        this.#answer = answer
        this.#produced = true
      }
      const usage = (record['message'] as { usage?: Record<string, unknown> } | null)?.usage
      const count = (key: string): number | null => {
        const value = usage?.[key]
        return typeof value === 'number' && Number.isFinite(value) ? value : null
      }
      const input = count('input')
      const output = count('output')
      const total = count('totalTokens')
      if (input === null && output === null && total === null) return { frames: [] }
      return {
        frames: [
          {
            kind: 'chunk',
            chunk: {
              type: 'usage',
              usage: { inputTokens: input, outputTokens: output, totalTokens: total },
            },
          },
        ],
      }
    }

    if (type === 'agent_end') {
      // Pi retries by itself; saying so beats a turn that looks stalled until it
      // recovers or gives up.
      if (record['willRetry'] === true) this.#failure = 'pi 正在重试这一轮'
      return { frames: [] }
    }

    return { frames: [] }
  }

  /**
   * Closes the turn, whichever way it ended.
   *
   * A turn that never closed would look like it is still running, and one that
   * produced nothing would leave a blank answer with no reason — Pi exits cleanly
   * after a model step that returned no content at all, so silence is a failure
   * worth naming.
   */
  finish(input: {
    exitCode: number | null
    stderr: string
    /** Why the turn failed, when the caller already knows (a refused command, a crash). */
    failure?: string | null
    /** The stored question's entry id, when the kernel reported one. */
    forkId?: string
  }): PiFrame[] {
    const frames: PiFrame[] = []
    let failure = input.failure ?? this.#failure

    if (failure === null && !this.#cancelled && input.exitCode !== null && input.exitCode !== 0) {
      failure = `pi 退出码 ${String(input.exitCode)}${tail(input.stderr)}`
    }
    if (failure === null && !this.#cancelled && !this.#produced) {
      failure = this.#thought
        ? 'pi 只给出了思考，没有回答'
        : `pi 没有返回任何内容${tail(input.stderr)}`
    }

    // A run that streamed nothing would otherwise close with an empty bubble; when
    // deltas did arrive the window already holds the text and drops this.
    if (failure === null && !this.#cancelled && this.#answer.length > 0) {
      frames.push({
        kind: 'event',
        type: 'assistant/message',
        data: { message: { role: 'assistant', content: [{ type: 'text', text: this.#answer }] } },
      })
    }

    frames.push({
      kind: 'event',
      type: 'turn/end',
      data: {
        ...(input.forkId === undefined ? {} : { forkId: input.forkId }),
        reason: this.#cancelled
          ? { kind: 'aborted' }
          : failure === null
            ? { kind: 'completed' }
            : { kind: 'error', error: { message: failure } },
      },
    })
    return frames
  }
}

/** The tail of a child's stderr, as a clause to append to a failure reason. */
function tail(stderr: string): string {
  const text = stderr.trim().split('\n').slice(-2).join(' ')
  return text.length === 0 ? '' : `：${text}`
}
