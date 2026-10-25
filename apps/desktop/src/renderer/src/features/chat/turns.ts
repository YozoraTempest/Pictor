import type { ChatMessage, ForkPoint } from '@pictor/shared'

/** One visual segment inside an agent turn. */
export type TurnPart =
  /** Reasoning and tool calls, in the order they happened. */
  | { kind: 'activity'; id: string; messages: ChatMessage[] }
  | { kind: 'text'; id: string; text: string; fork?: ForkPoint }

export interface Turn {
  id: string
  /** The prompt that opened this turn; null when history starts mid-way. */
  user: ChatMessage | null
  parts: TurnPart[]
  startedAt: number | null
  finishedAt: number | null
  /** Boundary a fork after this turn keeps: the last event that belonged to it. */
  endSeq: number | null
  /**
   * Where to cut to ask this question again.
   *
   * Two kernels answer this differently, and both answers are theirs: one copies
   * whole turns, so branching at a question means branching at the boundary the
   * previous turn ended on; the other forks at the question's own entry id.
   */
  before: ForkPoint | null
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
        endSeq: message.seq ?? null,
        before: beforePointOf(message, turns.at(-1)?.endSeq ?? null, turns.length === 0),
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
        endSeq: null,
        before: null,
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

/**
 * The cut that lets this question be asked again.
 *
 * A kernel that branches by entry id points at the question itself; one that copies
 * whole turns points at where the previous turn ended. A question with neither — the
 * first in the loaded page — is not a fork point.
 */
function beforePointOf(
  message: ChatMessage,
  previousEnd: number | null,
  first: boolean,
): ForkPoint | null {
  // Nothing precedes the first turn in this page, so a branch there would be empty
  // for both kinds of kernel.
  if (first) return null
  if (message.forkId !== undefined) return { id: message.forkId }
  return previousEnd === null ? null : { seq: previousEnd }
}

function appendPart(turn: Turn, message: ChatMessage): void {
  if (typeof message.seq === 'number') turn.endSeq = message.seq

  // Reasoning belongs to the work the agent did, not to a block of its own: it
  // joins the same list as the tool calls, so one group holds the whole trail
  // and the transcript stays a short column instead of a stack of boxes.
  if (message.role === 'tool' || message.kind === 'thinking') {
    const last = turn.parts.at(-1)
    if (last?.kind === 'activity') {
      last.messages.push(message)
    } else {
      turn.parts.push({ kind: 'activity', id: `activity-${message.id}`, messages: [message] })
    }
    return
  }

  const last = turn.parts.at(-1)
  if (last?.kind === 'text') {
    last.text += message.text
    // The merged block ends where its newest row ends, which is the boundary a
    // fork after that block keeps.
    if (typeof message.seq === 'number') last.fork = { seq: message.seq }
  } else {
    turn.parts.push({
      kind: 'text',
      id: `text-${message.id}`,
      text: message.text,
      ...(typeof message.seq === 'number' ? { fork: { seq: message.seq } } : {}),
    })
  }
  turn.answer += message.text
}

/** One row inside an activity group. */
export type ActivityItem =
  { kind: 'thinking'; id: string; text: string } | { kind: 'tool'; message: ChatMessage }

/**
 * Splits an activity group into rows.
 *
 * Reasoning streams as many small messages; neighbouring ones are merged so the
 * group shows one `思考` row, while its position relative to the tool calls
 * it was interleaved with stays exact.
 */
export function groupActivityItems(messages: readonly ChatMessage[]): ActivityItem[] {
  const items: ActivityItem[] = []

  for (const message of messages) {
    if (message.kind === 'thinking') {
      const last = items.at(-1)
      if (last?.kind === 'thinking') {
        last.text += message.text
        continue
      }
      items.push({ kind: 'thinking', id: `thinking-${message.id}`, text: message.text })
      continue
    }

    items.push({ kind: 'tool', message })
  }

  return items
}

/** Index of the turn a message belongs to, or -1. */
export function findTurnIndex(turns: readonly Turn[], messageId: string): number {
  return turns.findIndex(
    (turn) =>
      turn.user?.id === messageId ||
      turn.parts.some((part) =>
        part.kind === 'activity'
          ? part.messages.some((message) => message.id === messageId)
          : part.id.endsWith(messageId),
      ),
  )
}
