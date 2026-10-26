/**
 * Who wrote one row.
 *
 * `notice` is not a conversation turn: it is something the runtime did to the
 * transcript itself — compacting the context, for one — and it is drawn as a divider
 * rather than as a bubble, because nobody said it.
 */
export type ChatRole = 'user' | 'assistant' | 'tool' | 'notice'

/** Something that happened to the transcript, rather than in it. */
export interface ChatNotice {
  kind: 'compaction'
  /** Tokens the runtime removed, when it reported a count. */
  savedTokens: number | null
  /** The summary that replaced them; empty when the kernel did not send one. */
  summary: string
}

/** One step the agent is tracking for this conversation. */
export interface ChatTodoItem {
  content: string
  status: 'pending' | 'in_progress' | 'completed'
}

/**
 * Where a conversation stands, as the runtime sees it.
 *
 * Three states share one home because they share one property: they are *current*,
 * not historical. A transcript accumulates rows; a todo list, a plan mode and a job
 * roster are each replaced wholesale, so the newest snapshot is the whole truth and a
 * reload has to land on the same one.
 */
export interface ChatPlanState {
  /** The conversation is exploring rather than changing files. */
  active: boolean
  /** A `/plan` command is still running, so `active` has not caught up yet. */
  pending: boolean
}

/**
 * One agent this conversation delegated work to.
 *
 * A subagent is not a row: the runtime documents it as a *direct child session* with its
 * own log, recorded in the parent as a discovery fact. So this is a link — who was
 * started, under what name — and reading the child's steps is a separate, on-demand read
 * of that session. `mode` is the kernel's own word (`one-shot`, `continuable`, or
 * `external` for a provider that has no local session at all).
 */
export interface ChatSubagent {
  /** The kernel's own child identity; opaque to Pictor. */
  id: string
  /** Short task label the runtime kept with the child. */
  label: string
  mode: string
  /** Epoch ms, when the kernel recorded it. */
  createdAt: number | null
}

/**
 * Whether this child has a session to read.
 *
 * An external provider runs elsewhere and keeps no local log, so a "show the steps"
 * control there would promise something no read can answer.
 */
export function isLocalSubagent(subagent: ChatSubagent): boolean {
  return subagent.mode !== 'external'
}

/**
 * One background execution the runtime is running for this conversation.
 *
 * `running` and `stopping` are live; the other three are terminal and never move
 * again. `detail` is the runtime's own last word — an exit code, a kill reason.
 */
export interface ChatJob {
  id: string
  /** Producer kind (`bash`, `subagent`, …), as the runtime names it. */
  kind: string
  label: string
  status: 'running' | 'stopping' | 'completed' | 'killed' | 'failed'
  /** Epoch ms. */
  startedAt: number
  finishedAt: number | null
  detail: string | null
}

/** What one turn cost, in the provider's own count. `null` means it said nothing. */
export interface ChatUsage {
  input: number | null
  output: number | null
  total: number | null
}

export interface ChatMessage {
  /** Stable id derived from the JSONL entry index. */
  id: string
  role: ChatRole
  text: string
  timestamp: number | null
  /**
   * Event boundary a fork from this row keeps (`session/fork` atSeq).
   *
   * A row read from history carries its own event's sequence; a row the window
   * streamed carries the boundary the runtime reported for its turn. Absent means
   * the row is not a place to branch from.
   */
  seq?: number
  /**
   * The kernel's own name for the fork point this row starts at.
   *
   * A kernel that branches by entry id (`pi` forks from a user message's entry)
   * cannot be addressed with `seq`, so the id travels with the row instead. Absent
   * means this row is not a fork point for that kernel.
   */
  forkId?: string
  toolName?: string
  /** Runtime identity of the call, so a streamed row and its result can meet. */
  toolCallId?: string
  /** True while the model is still writing the call's arguments. */
  pending?: boolean
  /** Arguments as far as they have arrived; parsed `input` follows on start. */
  argumentsText?: string
  isError?: boolean
  /** True when a tool guard denied the call; the text holds the reason. */
  blocked?: boolean
  /** Assistant content kind; defaults to the visible answer. */
  kind?: 'text' | 'thinking'
  /** Raw arguments a tool call was given; only tools carry this. */
  input?: unknown
  /**
   * Unified diff a tool reported for its change (`edit`).
   *
   * The tool computed it from the real file, so it is more trustworthy than
   * diffing the call arguments, and it survives a reload via the JSONL entry.
   */
  diff?: string
  /** Images the user attached to this message; base64, no data URL prefix. */
  images?: ChatImage[]
  /**
   * What the model reported for the request that produced this row.
   *
   * It rides on the row rather than beside the transcript so a reloaded conversation
   * still knows what its last turn cost: the meter reads the newest one.
   */
  usage?: ChatUsage
  /** Present on a `notice` row: what the runtime did to this transcript. */
  notice?: ChatNotice
}

/** One image the user pasted or dropped into the composer. */
export interface ChatImage {
  /** MIME type, e.g. `image/png`. */
  mediaType: string
  /** Base64 payload without the `data:` prefix. */
  data: string
  /** Original file name when the image came from disk. */
  name?: string
}

/**
 * When a kernel that cannot stop a call should ask first.
 *
 * `never` runs calls straight through; `mutating` holds anything that can change the
 * workspace or reach outside it. A kernel that enforces its own sandbox decides this
 * itself, so the mode only means something where Pictor owns the decision — it is
 * therefore a kernel capability, not an app-wide setting.
 */
export type ApprovalMode = 'never' | 'mutating'

/**
 * Where a conversation should be cut.
 *
 * `seq` is the durable event boundary dsh forks at; `id` is the kernel's own entry
 * id for a kernel that forks by message. A caller sends what its rows carry and the
 * kernel takes what it can address.
 */
export interface ForkPoint {
  seq?: number
  id?: string
}

/** A conversation's history, newest page last. */
export interface ChatHistoryPage {
  messages: ChatMessage[]
  /** Offset to pass to the next history call to load older messages. */
  nextOffset: number
  hasMore: boolean
  /**
   * The current states, replayed from the same events the live stream carries.
   *
   * Absent means the kernel does not keep this state at all — not that it is empty:
   * an empty todo list and "no todo list here" are different answers, and only the
   * second one should hide a panel.
   */
  todos?: ChatTodoItem[]
  plan?: ChatPlanState
  jobs?: ChatJob[]
  /** Agents this conversation delegated to; absent when the kernel has none. */
  subagents?: ChatSubagent[]
}

/** Events forwarded from the main process to the renderer. */
export type ChatEvent =
  | { type: 'run.started'; sessionId: string; runId: string; seq?: number }
  | { type: 'message.delta'; sessionId: string; runId: string; text: string }
  | { type: 'thinking.delta'; sessionId: string; runId: string; text: string }
  /** Token accounting for the turn, as the provider reported it. */
  | {
      type: 'run.usage'
      sessionId: string
      runId: string
      input: number | null
      output: number | null
      total: number | null
    }
  /**
   * A tool call the model is still writing.
   *
   * The call is not executable yet — the arguments are incomplete — but showing it
   * now is the difference between a turn that looks stalled and one that is working.
   */
  | {
      type: 'tool.pending'
      sessionId: string
      runId: string
      callId: string
      tool: string
      /** Arguments as far as they have streamed; not valid JSON until it finishes. */
      argumentsText: string
    }
  | {
      type: 'tool.started'
      sessionId: string
      runId: string
      tool: string
      input: unknown
      callId?: string
    }
  | {
      type: 'tool.finished'
      sessionId: string
      runId: string
      tool: string
      output: string
      isError: boolean
      /** Unified diff the tool reported, when it made one. */
      diff?: string
      callId?: string
    }
  | {
      type: 'tool.blocked'
      sessionId: string
      runId: string
      tool: string
      reason: string
    }
  | {
      type: 'run.finished'
      sessionId: string
      runId: string
      reason: 'stop' | 'cancelled' | 'error'
      message?: string
      /** Sequence of `turn/end`: the boundary a fork after this turn keeps. */
      seq?: number
      /**
       * The kernel's fork point for the question this turn answered.
       *
       * A kernel that branches by entry id only learns it once the turn is stored,
       * so it arrives here rather than with `run.started`.
       */
      forkId?: string
    }
  | {
      /** The runtime is re-running a failed model step inside the same turn. */
      type: 'run.retrying'
      sessionId: string
      runId: string
      attempt: number
      maxAttempts: number
      message: string
    }
  /**
   * The runtime replaced part of the context with a summary.
   *
   * Sent when it happens — during a turn or from `/compact` — because the transcript
   * would otherwise appear to lose history without explanation. `runId` is absent for
   * a compaction nobody asked for inside a turn.
   */
  | {
      type: 'run.compacted'
      sessionId: string
      runId?: string
      /** Tokens the kernel said it removed; null when it reported no count. */
      savedTokens: number | null
      summary: string | null
      /** Why it compacted: the kernel's own word (`threshold`, `manual`, …). */
      reason: string | null
    }
  /**
   * The agent replaced its whole task list.
   *
   * Wholesale, not incremental: the runtime logs a snapshot per write and replays
   * last-write-wins, so a reload lands on the same list without replaying a diff.
   */
  | { type: 'todo.updated'; sessionId: string; todos: ChatTodoItem[] }
  /**
   * Plan mode turned on or off, or a `/plan` command is still settling.
   *
   * `active` is null when the event only reports that a command is in flight: a
   * `/plan` issued but not yet settled cannot say which mode it will land in, and
   * guessing here would flip the badge before the runtime agrees.
   */
  | {
      type: 'plan.changed'
      sessionId: string
      active: boolean | null
      pending: boolean
    }
  /** One background job registered, moved, or settled. Upsert by `job.id`. */
  | { type: 'job.updated'; sessionId: string; job: ChatJob }
  /** The runtime started an agent for this conversation. Upsert by `subagent.id`. */
  | { type: 'subagent.linked'; sessionId: string; subagent: ChatSubagent }

/**
 * One decision the runtime is waiting for.
 *
 * The runtime asks before an operation its policy does not cover, and holds the
 * tool call until an owner client answers. `eventId` is the handle the answer
 * quotes; there is no session binding on the wire, so the request is shown to
 * whichever conversation is open.
 */
export interface ApprovalRequest {
  eventId: string
  /**
   * Conversation the call belongs to, when the kernel can say.
   *
   * dsh's prompt carries no session binding, so its requests leave this out and the
   * card follows whichever conversation is open. A kernel that asks per process can
   * name the conversation, and then the card is shown only there.
   */
  sessionId?: string
  /** Tool that triggered it, when the runtime names one. */
  tool: string | null
  /** Why approval is needed, in the runtime's words. */
  reason: string | null
}

/** One answer a model offered for a question it asked. */
export interface ChatQuestionOption {
  label: string
  description?: string
}

/**
 * One question the model asked through `ask_user_question`.
 *
 * The runtime holds the tool call until an answer arrives, so this is not a
 * transcript row: it is a prompt the window has to settle, like an approval.
 */
export interface ChatQuestion {
  id: string
  question: string
  /** Short label the model wants above the question. */
  header?: string
  /** Context the question is about, when the model attached any. */
  detail?: string
  /** Offered answers; absent when the model wants free text. */
  options?: ChatQuestionOption[]
  multiSelect?: boolean
  /**
   * Text the person is asked to edit rather than write from scratch.
   *
   * Present means the question is a draft — a commit message, a config block, a
   * prompt — and the card shows it in an editor seeded with this text. Absent means
   * free text starts empty.
   */
  prefill?: string
}

/** A batch of questions one tool call is waiting on. */
export interface ChatQuestionRequest {
  eventId: string
  /**
   * Conversation the question belongs to, when the kernel can say.
   *
   * dsh's request carries no session, so its card follows whichever conversation is
   * open. A kernel that asks per process names it, and the card can say when the
   * question came from somewhere else.
   */
  sessionId?: string
  questions: ChatQuestion[]
}

/**
 * One settled answer.
 *
 * `selected` holds the labels of the options picked; `custom` is the text typed
 * instead of (or beside) them. Both empty is a deliberate "no answer".
 */
export interface ChatAnswer {
  id: string
  selected: string[]
  custom?: string
}
