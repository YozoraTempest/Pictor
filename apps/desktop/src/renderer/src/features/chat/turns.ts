import type { ChatMessage } from '@pictor/shared'

/** One visual segment inside an agent turn. */
export type TurnPart =
  | { kind: 'thinking'; id: string; text: string }
  | { kind: 'text'; id: string; text: string }
  | { kind: 'tools'; id: string; messages: ChatMessage[] }

export interface Turn {
  id: string
  /** The prompt that opened this turn; null when history starts mid-way. */
  user: ChatMessage | null
  parts: TurnPart[]
  startedAt: number | null
  finishedAt: number | null
  /** Prompt text, shown by the timeline rail. */
  prompt: string
  /** Answer text without reasoning or tool output, shown as the rail summary. */
  answer: string
}

/** Collapses the raw event log into the blocks the transcript renders. */
export function buildTurns(messages: readonly ChatMessage[]): Turn[] {
  const turns: Turn[] = []
  let current: Turn | null = null

  for (const message of messages) {
    if (message.role === 'user') {
      current = {
        id: `turn-${message.id}`,
        user: message,
        parts: [],
        startedAt: message.timestamp,
        finishedAt: null,
        prompt: message.text,
        answer: '',
      }
      turns.push(current)
      continue
    }

    if (current === null) {
      // History can begin with an assistant reply when the prompt scrolled out of
      // the loaded page; keep those rows instead of dropping them.
      current = {
        id: `turn-${message.id}`,
        user: null,
        parts: [],
        startedAt: message.timestamp,
        finishedAt: null,
        prompt: '',
        answer: '',
      }
      turns.push(current)
    }

    appendPart(current, message)
    if (message.timestamp !== null) current.finishedAt = message.timestamp
  }

  return turns
}

function appendPart(turn: Turn, message: ChatMessage): void {
  const last = turn.parts.at(-1)

  if (message.role === 'tool') {
    if (last?.kind === 'tools') {
      last.messages.push(message)
    } else {
      turn.parts.push({ kind: 'tools', id: `tools-${message.id}`, messages: [message] })
    }
    return
  }

  if (message.kind === 'thinking') {
    if (last?.kind === 'thinking') {
      last.text += message.text
    } else {
      turn.parts.push({ kind: 'thinking', id: `thinking-${message.id}`, text: message.text })
    }
    return
  }

  if (last?.kind === 'text') {
    last.text += message.text
  } else {
    turn.parts.push({ kind: 'text', id: `text-${message.id}`, text: message.text })
  }
  turn.answer += message.text
}

/** Index of the turn a message belongs to, or -1. */
export function findTurnIndex(turns: readonly Turn[], messageId: string): number {
  return turns.findIndex(
    (turn) =>
      turn.user?.id === messageId ||
      turn.parts.some((part) =>
        part.kind === 'tools'
          ? part.messages.some((message) => message.id === messageId)
          : part.id.endsWith(messageId),
      ),
  )
}
