import type { ChatMessage } from '@pictor/shared'

/**
 * Reading a Pi session file back into transcript rows.
 *
 * Pi's session file is the conversation — Pictor keeps no transcript of its own —
 * so this has to reproduce what the window showed live: the answer, the thinking
 * that preceded it, and one row per tool call with its output on it. The mapping
 * lives here, apart from the file and the process, because it is the only part of
 * the driver with branches worth testing.
 *
 * A stored line looks like `{type: 'message', message: {...}}`; the assistant's
 * `content` is a list of blocks (`text`, `thinking`, `toolCall`) and a tool's
 * output arrives later as its own `toolResult` message naming the call it answers.
 */

interface Block {
  type?: unknown
  text?: unknown
  thinking?: unknown
  id?: unknown
  name?: unknown
  arguments?: unknown
}

export interface StoredMessage {
  role?: unknown
  content?: unknown
  toolCallId?: unknown
  toolName?: unknown
  isError?: unknown
  timestamp?: unknown
}

export interface StoredRecord {
  type?: unknown
  /** The session entry's own id: Pi's name for this point in the conversation. */
  id?: unknown
  message?: StoredMessage | null
}

function blocksOf(content: unknown): Block[] {
  if (!Array.isArray(content)) return []
  return content.flatMap((block): Block[] => {
    if (typeof block !== 'object' || block === null) return []
    return [block as Block]
  })
}

/** The visible text of a message: `text` blocks only, thinking excluded. */
export function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  return blocksOf(content)
    .flatMap((block): string[] =>
      block.type === 'text' && typeof block.text === 'string' ? [block.text] : [],
    )
    .join('')
}

function thinkingOf(content: unknown): string {
  return blocksOf(content)
    .flatMap((block): string[] =>
      block.type === 'thinking' && typeof block.thinking === 'string' ? [block.thinking] : [],
    )
    .join('')
}

export function historyRows(records: readonly StoredRecord[]): ChatMessage[] {
  const rows: ChatMessage[] = []
  /** Rows waiting for the output of the call that opened them. */
  const calls = new Map<string, ChatMessage>()
  const add = (row: Omit<ChatMessage, 'id'>): ChatMessage => {
    const message: ChatMessage = { id: `pi-${String(rows.length)}`, ...row }
    rows.push(message)
    return message
  }

  for (const record of records) {
    if (record.type !== 'message' || typeof record.message !== 'object') continue
    const message = record.message
    if (message === null) continue
    const role = message.role
    const timestamp = typeof message.timestamp === 'number' ? message.timestamp : null
    // Pi forks from a user message's entry id, so the question row is the one that
    // carries a fork point. Answers and tool rows are not forkable on their own.
    const forkId = typeof record.id === 'string' && role === 'user' ? record.id : undefined

    if (role === 'user') {
      const text = textOf(message.content)
      if (text.length > 0) {
        add({ role: 'user', text, timestamp, ...(forkId === undefined ? {} : { forkId }) })
      }
      continue
    }

    if (role === 'assistant') {
      // Thinking first: it is what the model produced before the answer, and the
      // live transcript shows it in that order.
      const thinking = thinkingOf(message.content)
      if (thinking.length > 0) {
        add({ role: 'assistant', kind: 'thinking', text: thinking, timestamp })
      }
      const text = textOf(message.content)
      if (text.length > 0) add({ role: 'assistant', text, timestamp })

      for (const block of blocksOf(message.content)) {
        if (block.type !== 'toolCall') continue
        const callId = typeof block.id === 'string' ? block.id : ''
        const row = add({
          role: 'tool',
          text: '',
          timestamp,
          toolName: typeof block.name === 'string' ? block.name : 'tool',
          input: block.arguments ?? null,
          ...(callId.length === 0 ? {} : { toolCallId: callId }),
        })
        if (callId.length > 0) calls.set(callId, row)
      }
      continue
    }

    if (role !== 'toolResult') continue
    const callId = typeof message.toolCallId === 'string' ? message.toolCallId : ''
    const output = textOf(message.content) || JSON.stringify(message.content ?? '')
    const failed = message.isError === true
    const known = calls.get(callId)
    if (known === undefined) {
      // A result whose call is not in this file (a truncation, or a session that
      // started mid-conversation): the output still belongs in the transcript.
      add({
        role: 'tool',
        text: output,
        timestamp,
        toolName: typeof message.toolName === 'string' ? message.toolName : 'tool',
        isError: failed,
        ...(callId.length === 0 ? {} : { toolCallId: callId }),
      })
      continue
    }
    known.text = output
    if (failed) known.isError = true
  }

  return rows
}
