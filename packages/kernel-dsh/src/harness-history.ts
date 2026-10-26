import type { ChatHistoryPage, ChatMessage, ChatUsage } from '@pictor/shared'

interface SessionEvent {
  type?: string
  seq?: number
  time?: number
  data?: Record<string, unknown>
}

/** Whether a stored tool message marked itself as a failure. */
function messageIsError(message: { isError?: unknown }): boolean {
  return message.isError === true
}

function textOf(content: unknown): string {
  if (!Array.isArray(content)) return ''
  return content
    .flatMap((block): string[] => {
      if (typeof block !== 'object' || block === null) return []
      const entry = block as { type?: unknown; text?: unknown }
      return entry.type === 'text' && typeof entry.text === 'string' ? [entry.text] : []
    })
    .join('')
}

/** A row's own event sequence, when the wire carried one. */
function seqOf(event: SessionEvent): { seq?: number } {
  return typeof event.seq === 'number' ? { seq: event.seq } : {}
}

/**
 * The provider's count for one step, in the shape the meter reads.
 *
 * dsh reports it on the event beside the message (`usage.inputTokens` and friends),
 * not inside it, and omits any half it did not count.
 */
function usageOf(data: Record<string, unknown>): ChatUsage | undefined {
  const usage = data['usage']
  if (typeof usage !== 'object' || usage === null) return undefined
  const raw = usage as Record<string, unknown>
  const count = (key: string): number | null => {
    const value = raw[key]
    return typeof value === 'number' && Number.isFinite(value) ? value : null
  }
  const input = count('inputTokens')
  const output = count('outputTokens')
  const total = count('totalTokens')
  if (input === null && output === null && total === null) return undefined
  return { input, output, total }
}

function messageContent(data: Record<string, unknown>): unknown {
  return (data['message'] as { content?: unknown } | null)?.content ?? data['content']
}

/**
 * Project durable session events into the transcript the renderer renders.
 *
 * Two rules keep the transcript honest: only `source.kind === 'user'` messages
 * are shown as the user's own words (the runtime also files injected runtime
 * context and skill reminders as user-role messages), and a tool call plus its
 * result become one row, because that is how the transcript draws them.
 */
export function projectHarnessEvents(events: readonly unknown[]): ChatMessage[] {
  const messages: ChatMessage[] = []
  const toolRows = new Map<string, number>()
  const seen = new Set<string>()

  for (const raw of events) {
    if (typeof raw !== 'object' || raw === null) continue
    const event = raw as SessionEvent
    const data = event.data ?? {}
    const timestamp = typeof event.time === 'number' ? event.time : null
    const id = typeof data['id'] === 'string' ? data['id'] : `e${String(event.seq ?? 0)}`

    switch (event.type) {
      case 'user/message': {
        const source = data['source'] as { kind?: unknown } | null
        if (source?.kind !== 'user' || seen.has(id)) continue
        const text = textOf(data['content'] ?? messageContent(data))
        if (text.length === 0) continue
        seen.add(id)
        messages.push({ id, role: 'user', text, timestamp, ...seqOf(event) })
        break
      }

      /**
       * A compaction is durable, so the row has to be too.
       *
       * The checkpoint message the runtime appends in its place is skipped above: it
       * is filed under a source this project only shows for `user`, and drawing the
       * summary as if the person had typed it would be a lie about who said what.
       */
      case 'compaction/summary': {
        const saved = data['shadowedTokenCount']
        const summary = data['summary']
        messages.push({
          id: `compaction-${String(data['compactionId'] ?? id)}`,
          role: 'notice',
          text: '',
          timestamp,
          ...seqOf(event),
          notice: {
            kind: 'compaction',
            savedTokens: typeof saved === 'number' && Number.isFinite(saved) ? saved : null,
            summary: typeof summary === 'string' ? summary : '',
          },
        })
        break
      }

      case 'assistant/message': {
        const text = textOf(messageContent(data))
        if (text.length === 0) continue
        const usage = usageOf(data)
        messages.push({
          id,
          role: 'assistant',
          text,
          timestamp,
          ...seqOf(event),
          ...(usage === undefined ? {} : { usage }),
        })
        break
      }

      case 'tool/call': {
        const callId = String(data['callId'] ?? data['id'] ?? id)
        if (toolRows.has(callId)) continue
        toolRows.set(callId, messages.length)
        messages.push({
          id: callId,
          role: 'tool',
          text: '',
          timestamp,
          ...seqOf(event),
          toolName: String(data['name'] ?? data['tool'] ?? 'tool'),
          input: data['arguments'] ?? data['input'] ?? null,
        })
        break
      }

      case 'tool/result': {
        // The call id is on the event; the answer is inside the message it carries,
        // which is where the runtime files both the content and the error flag.
        const message = data['message'] as
          { content?: unknown; toolCallId?: unknown; isError?: unknown } | undefined
        const callId = String(
          data['callId'] ?? data['toolCallId'] ?? message?.toolCallId ?? data['id'] ?? '',
        )
        const index = toolRows.get(callId)
        const result = data['output'] ?? data['result'] ?? data['content'] ?? message?.content ?? ''
        const text = typeof result === 'string' ? result : textOf(result)
        const isError =
          data['isError'] === true || (message !== undefined && messageIsError(message))

        if (index === undefined) {
          // A result without its call still has to be visible.
          messages.push({
            id: `r${callId}`,
            role: 'tool',
            text,
            timestamp,
            ...seqOf(event),
            toolName: String(data['name'] ?? data['tool'] ?? 'tool'),
            isError,
          })
          break
        }
        const existing = messages[index]
        if (existing !== undefined) messages[index] = { ...existing, text, isError }
        break
      }

      default:
        break
    }
  }

  return messages
}

/**
 * Read one page of a kernel session log.
 *
 * Windowing matches the Pi reader's, so the transcript's older-messages button
 * behaves the same whichever runtime produced the log.
 */
export function loadHarnessHistory(
  events: readonly unknown[],
  limit: number,
  offset: number,
): ChatHistoryPage {
  const all = projectHarnessEvents(events)
  const end = Math.max(0, all.length - offset)
  const start = Math.max(0, end - limit)
  const messages = all.slice(start, end)

  return {
    messages,
    nextOffset: offset + messages.length,
    hasMore: start > 0,
  }
}
