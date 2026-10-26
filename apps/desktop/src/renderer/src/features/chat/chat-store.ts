import { create } from 'zustand'

import type { ChatEvent, ChatImage, ChatMessage, ModelEffort } from '@pictor/shared'

import { lastUsageOf, type TurnUsage } from './context-usage.js'

/** Phase of a running agent, shown next to its name. */
export type ChatPhase = 'idle' | 'connecting' | 'thinking' | 'tool' | 'writing'

/** Everything one conversation needs, kept apart from every other conversation. */
export interface ChatSlice {
  sessionId: string
  path: string | null
  messages: ChatMessage[]
  offset: number
  hasMore: boolean
  loading: boolean
  running: boolean
  /** Wall-clock start of the current run, for the "总时长" label. */
  runStartedAt: number | null
  runFinishedAt: number | null
  phase: ChatPhase
  currentTool: string | null
  error: string | null
  /** Set while the runtime re-runs a failed model step inside this turn. */
  retry: { attempt: number; maxAttempts: number; message: string } | null
  /** Tokens the last turn used, as the provider reported them. */
  usage: TurnUsage | null
}

interface ChatState {
  /** Conversation on screen; `null` when a draft or nothing is selected. */
  viewing: string | null
  /** Open conversations by session id — several can be running at once. */
  chats: Record<string, ChatSlice>
  /** Slice of `viewing`, so components read one stable object. */
  current: ChatSlice
  /**
   * Reasoning level the next send asks for. `null` means "send none"; `undefined`
   * means the user has not touched it, so the active model's designed level applies.
   */
  effort: ModelEffort | null | undefined
  setEffort: (level: ModelEffort | null | undefined) => void
  open: (sessionId: string | null, options?: { reload?: boolean }) => Promise<void>
  close: (sessionId: string) => Promise<void>
  send: (prompt: string, images?: ChatImage[]) => Promise<void>
  stop: () => Promise<void>
  loadOlder: () => Promise<void>
  handleEvent: (event: ChatEvent) => void
}

const EMPTY: ChatSlice = {
  sessionId: '',
  path: null,
  messages: [],
  offset: 0,
  hasMore: false,
  loading: false,
  running: false,
  runStartedAt: null,
  runFinishedAt: null,
  phase: 'idle',
  currentTool: null,
  error: null,
  retry: null,
  usage: null,
}

function emptySlice(sessionId: string): ChatSlice {
  return { ...EMPTY, sessionId }
}

/**
 * Index of the newest row for `tool` that is still waiting for a result, or -1.
 *
 * Scans backwards because the newest row belongs to the current call: matching
 * forwards let an older row (for example a blocked one) steal a later call's
 * result, which leaves that card spinning forever.
 */
function findPendingToolRow(messages: readonly ChatMessage[], tool: string): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message === undefined) continue
    if (message.role !== 'tool' || message.toolName !== tool) continue
    if (message.text === '') return index
    // The newest row for this tool is already resolved, so this call has no
    // pending row: anything older belongs to a previous call.
    return -1
  }

  return -1
}

/**
 * Row showing one streamed call, by the runtime's call id.
 *
 * A call is identified by that id, not by its tool: two `read` calls can be in
 * flight at once, and matching on the name would let one overwrite the other.
 */
function indexOfCall(messages: readonly ChatMessage[], callId: string): number {
  return messages.findIndex((message) => message.toolCallId === callId)
}

/** Index of the newest row for `tool`, whatever its state, or -1. */
function findLastToolRow(messages: readonly ChatMessage[], tool: string): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.role === 'tool' && message.toolName === tool) return index
  }

  return -1
}

/**
 * Newest question that has no boundary yet.
 *
 * One prompt produces exactly one `turn/start`, so the oldest unanswered question
 * is the one that boundary belongs to; without this the menu could never branch
 * from something the user just typed.
 */
/** The newest question that still has no kernel fork point attached. */
function lastUnforkedUserRow(messages: readonly ChatMessage[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.role === 'user' && message.forkId === undefined) return index
  }

  return -1
}

function lastUnsequencedUserRow(messages: readonly ChatMessage[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.role === 'user' && message.seq === undefined) return index
  }

  return -1
}

/** Newest answered row of a turn; the boundary a fork after it would keep. */
function lastAnswerRow(messages: readonly ChatMessage[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.role === 'assistant' && message.kind !== 'thinking') return index
  }

  return -1
}

/** Guards a slow history load against a newer one for the same conversation. */
const loadTokens = new Map<string, number>()

export const useChatStore = create<ChatState>()((set, get) => {
  /** Writes one conversation's slice and keeps `current` in sync with it. */
  function patch(sessionId: string, updater: (slice: ChatSlice) => Partial<ChatSlice>): void {
    set((state) => {
      const slice = state.chats[sessionId] ?? emptySlice(sessionId)
      const next = { ...slice, ...updater(slice) }
      return {
        chats: { ...state.chats, [sessionId]: next },
        current: state.viewing === sessionId ? next : state.current,
      }
    })
  }

  return {
    viewing: null,
    chats: {},
    current: EMPTY,
    // Untouched until the composer knows which model is active; that model's own
    // designed level is what applies, so nothing is remembered here.
    effort: undefined,

    setEffort(level) {
      set({ effort: level })
    },

    async open(sessionId, options = {}) {
      if (sessionId === null) {
        set({ viewing: null, current: EMPTY })
        return
      }

      const existing = get().chats[sessionId]
      set({
        viewing: sessionId,
        current: existing ?? emptySlice(sessionId),
        ...(existing === undefined
          ? { chats: { ...get().chats, [sessionId]: emptySlice(sessionId) } }
          : {}),
      })

      // Already loaded: reopening would reset the transcript and drop the message
      // that was just appended optimistically. `reload` is the exception — it is
      // how a transcript read before the runtime was up gets a second chance.
      if (existing?.path != null && options.reload !== true) return

      const token = (loadTokens.get(sessionId) ?? 0) + 1
      loadTokens.set(sessionId, token)
      patch(sessionId, () => ({ loading: true, error: null }))

      try {
        const result = await window.pictor.openChat(sessionId)
        if (loadTokens.get(sessionId) !== token) return

        patch(sessionId, () => ({
          path: result.path,
          messages: result.history.messages,
          // Every row that reported its cost kept it, so a reloaded conversation still
          // has the numbers its last turn spent instead of an empty ring.
          usage: lastUsageOf(result.history.messages),
          offset: result.history.nextOffset,
          hasMore: result.history.hasMore,
          loading: false,
        }))
      } catch (reason) {
        if (loadTokens.get(sessionId) !== token) return
        patch(sessionId, () => ({
          error: reason instanceof Error ? reason.message : String(reason),
          loading: false,
        }))
      }
    },

    async close(sessionId) {
      loadTokens.delete(sessionId)
      set((state) => {
        const chats = { ...state.chats }
        delete chats[sessionId]
        const viewing = state.viewing === sessionId ? null : state.viewing
        return {
          chats,
          viewing,
          current: viewing === null ? EMPTY : (chats[viewing] ?? EMPTY),
        }
      })
    },

    async send(prompt, images = []) {
      const sessionId = get().viewing
      if (sessionId === null) return

      const slice = get().chats[sessionId]
      if (slice === undefined || slice.path === null || slice.running) return

      const trimmed = prompt.trim()
      if (trimmed.length === 0 && images.length === 0) return

      const userMessage: ChatMessage = {
        id: `user-${Date.now()}`,
        role: 'user',
        text: trimmed,
        timestamp: Date.now(),
        ...(images.length === 0 ? {} : { images }),
      }

      patch(sessionId, (current) => ({
        messages: [...current.messages, userMessage],
        running: true,
        error: null,
      }))

      try {
        await window.pictor.sendChat(
          sessionId,
          trimmed,
          images.length === 0 ? undefined : images,
          // An untouched level travels as "none": the host then sends no effort,
          // which is exactly what the model's own design asked for.
          get().effort ?? null,
        )
      } catch (reason) {
        patch(sessionId, () => ({
          running: false,
          error: reason instanceof Error ? reason.message : String(reason),
        }))
      }
    },

    async stop() {
      const sessionId = get().viewing
      if (sessionId === null) return
      await window.pictor.stopChat(sessionId)
    },

    async loadOlder() {
      const sessionId = get().viewing
      if (sessionId === null) return

      const slice = get().chats[sessionId]
      if (slice === undefined || slice.path === null || !slice.hasMore) return

      patch(sessionId, () => ({ loading: true }))
      try {
        const page = await window.pictor.chatHistory(slice.path, 50, slice.offset)
        patch(sessionId, (current) => ({
          messages: [...page.messages, ...current.messages],
          offset: page.nextOffset,
          hasMore: page.hasMore,
        }))
      } finally {
        patch(sessionId, () => ({ loading: false }))
      }
    },

    /**
     * Events carry their session id, so a run in a conversation that is not on
     * screen still updates its own slice — that is what makes parallel runs work.
     */
    handleEvent(event) {
      const sessionId = event.sessionId

      if (event.type === 'run.started') {
        patch(sessionId, (state) => ({
          running: true,
          error: null,
          phase: 'connecting',
          runStartedAt: Date.now(),
          runFinishedAt: null,
          currentTool: null,
          retry: null,
          // The prompt row was appended here, without a sequence; the turn opens
          // right after it, so that boundary is what a fork from the question
          // keeps. Only the newest unanswered row can claim it.
          messages:
            event.seq === undefined
              ? state.messages
              : state.messages.map((message, index) =>
                  index === lastUnsequencedUserRow(state.messages)
                    ? { ...message, seq: event.seq }
                    : message,
                ),
        }))
        return
      }

      if (event.type === 'run.retrying') {
        patch(sessionId, () => ({
          retry: {
            attempt: event.attempt,
            maxAttempts: event.maxAttempts,
            message: event.message,
          },
        }))
        return
      }

      if (event.type === 'run.usage') {
        patch(sessionId, () => ({
          usage: { input: event.input, output: event.output, total: event.total },
        }))
        return
      }

      if (event.type === 'thinking.delta') {
        patch(sessionId, (state) => {
          const last = state.messages.at(-1)
          const thinkingId = `thinking-${event.runId}`

          if (last !== undefined && last.kind === 'thinking' && last.id.startsWith(thinkingId)) {
            return {
              phase: 'thinking',
              messages: [...state.messages.slice(0, -1), { ...last, text: last.text + event.text }],
            }
          }

          const segment = state.messages.filter((message) =>
            message.id.startsWith(thinkingId),
          ).length

          return {
            phase: 'thinking',
            messages: [
              ...state.messages,
              {
                id: `${thinkingId}-${String(segment)}`,
                role: 'assistant',
                kind: 'thinking',
                text: event.text,
                timestamp: Date.now(),
              },
            ],
          }
        })
        return
      }

      if (event.type === 'message.delta') {
        patch(sessionId, (state) => {
          const last = state.messages.at(-1)
          const streamId = `stream-${event.runId}`

          // Continue the newest answer bubble when it is still the last row.
          if (last !== undefined && last.role === 'assistant' && last.id.startsWith(streamId)) {
            return {
              phase: 'writing',
              messages: [...state.messages.slice(0, -1), { ...last, text: last.text + event.text }],
            }
          }

          // A tool row landed in between, so this is a new assistant segment. It
          // needs its own id: reusing the run id would duplicate a React key and
          // the transcript would stop updating until it remounted.
          const segment = state.messages.filter((message) => message.id.startsWith(streamId)).length

          return {
            phase: 'writing',
            messages: [
              ...state.messages,
              {
                id: `${streamId}-${String(segment)}`,
                role: 'assistant',
                text: event.text,
                timestamp: Date.now(),
              },
            ],
          }
        })
        return
      }

      if (event.type === 'tool.pending') {
        // The call is still being written: show it now, and rewrite the same row as
        // more arguments arrive instead of appending a row per token.
        patch(sessionId, (state) => {
          const messages = [...state.messages]
          const at = indexOfCall(messages, event.callId)
          const row: ChatMessage = {
            id: `tool-${event.callId}`,
            role: 'tool',
            text: '',
            timestamp: Date.now(),
            toolName: event.tool,
            toolCallId: event.callId,
            pending: true,
            argumentsText: event.argumentsText,
          }
          if (at >= 0) messages[at] = { ...row, timestamp: messages[at]?.timestamp ?? null }
          else messages.push(row)
          return { phase: 'tool', currentTool: event.tool, messages }
        })
        return
      }

      if (event.type === 'tool.started') {
        patch(sessionId, (state) => {
          const messages = [...state.messages]
          const at = event.callId === undefined ? -1 : indexOfCall(messages, event.callId)
          if (at >= 0) {
            // The streamed row and the real call are the same call: complete it in
            // place rather than leaving a stub above the real result.
            const existing = messages[at]
            if (existing !== undefined) {
              messages[at] = {
                id: `tool-${event.runId}-${String(at)}`,
                role: 'tool',
                text: '',
                timestamp: existing.timestamp,
                toolName: event.tool,
                input: event.input,
                ...(event.callId === undefined ? {} : { toolCallId: event.callId }),
              }
            }
            return { phase: 'tool', currentTool: event.tool, messages }
          }

          return {
            phase: 'tool',
            currentTool: event.tool,
            messages: [
              ...messages,
              {
                id: `tool-${event.runId}-${String(messages.length)}`,
                role: 'tool',
                text: '',
                timestamp: Date.now(),
                toolName: event.tool,
                input: event.input,
                ...(event.callId === undefined ? {} : { toolCallId: event.callId }),
              },
            ],
          }
        })
        return
      }
      if (event.type === 'tool.finished') {
        patch(sessionId, (state) => {
          const messages = [...state.messages]
          const byCall = event.callId === undefined ? -1 : indexOfCall(messages, event.callId)
          const pending = byCall >= 0 ? byCall : findPendingToolRow(messages, event.tool)

          if (pending >= 0) {
            const existing = messages[pending]
            if (existing !== undefined) {
              messages[pending] = {
                ...existing,
                text: event.output.slice(0, 4000),
                isError: event.isError,
                pending: false,
                ...(event.diff === undefined ? {} : { diff: event.diff }),
                ...(event.callId === undefined ? {} : { toolCallId: event.callId }),
              }
            }
            return { messages }
          }

          // A guarded call already carries its verdict; Pi still reports a finish,
          // and appending another row would show the same call twice.
          const last = findLastToolRow(messages, event.tool)
          if (last >= 0 && messages[last]?.blocked === true) return { messages }

          return {
            messages: [
              ...messages,
              {
                id: `tool-${event.runId}-${String(messages.length)}`,
                role: 'tool',
                text: event.output.slice(0, 4000),
                timestamp: Date.now(),
                toolName: event.tool,
                isError: event.isError,
                ...(event.callId === undefined ? {} : { toolCallId: event.callId }),
              },
            ],
          }
        })
        return
      }

      if (event.type === 'tool.blocked') {
        patch(sessionId, (state) => {
          const messages = [...state.messages]
          // The start event usually lands first; reuse that row so one call never
          // shows up twice (once as a failure, once as a blocked call).
          const index = findPendingToolRow(messages, event.tool)

          if (index >= 0) {
            const existing = messages[index]
            if (existing !== undefined) {
              messages[index] = {
                ...existing,
                text: event.reason,
                isError: true,
                blocked: true,
              }
            }
            return { messages }
          }

          return {
            messages: [
              ...messages,
              {
                id: `tool-${event.runId}-${String(messages.length)}`,
                role: 'tool',
                text: event.reason,
                timestamp: Date.now(),
                toolName: event.tool,
                isError: true,
                blocked: true,
              },
            ],
          }
        })
        return
      }

      if (event.type === 'run.compacted') {
        // The runtime replaced older turns with a summary. The row says so, at the
        // point in the transcript where it happened, and it survives a reload because
        // each kernel's history reader emits the same row.
        patch(sessionId, (state) => ({
          messages: [
            ...state.messages,
            {
              id: `notice-${String(state.messages.length)}-${String(Date.now())}`,
              role: 'notice',
              text: '',
              timestamp: Date.now(),
              notice: {
                kind: 'compaction',
                savedTokens: event.savedTokens,
                summary: event.summary ?? '',
              },
            },
          ],
        }))
        return
      }

      // The run is over: any tool row still waiting for a result would spin
      // forever, so close it with an explicit outcome.
      patch(sessionId, (state) => {
        const messages = state.messages.map((message) =>
          message.role === 'tool' && message.text === ''
            ? { ...message, text: '运行结束时没有拿到结果', isError: true }
            : message,
        )
        const answer = lastAnswerRow(messages)
        if (event.seq !== undefined && answer >= 0) {
          messages[answer] = { ...messages[answer]!, seq: event.seq }
        }
        // A kernel that forks by message names the question's entry id once the turn
        // is stored; without it the question could not be re-asked from here.
        const question = lastUnforkedUserRow(messages)
        if (event.forkId !== undefined && question >= 0) {
          messages[question] = { ...messages[question]!, forkId: event.forkId }
        }
        return {
          running: false,
          phase: 'idle',
          currentTool: null,
          runFinishedAt: Date.now(),
          ...(event.reason === 'error' ? { error: event.message ?? 'run failed' } : {}),
          messages,
        }
      })
    },
  }
})
