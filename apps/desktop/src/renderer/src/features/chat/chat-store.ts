import { create } from 'zustand'

import type { ChatEvent, ChatImage, ChatMessage } from '@pictor/shared'

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
}

interface ChatState {
  /** Conversation on screen; `null` when a draft or nothing is selected. */
  viewing: string | null
  /** Open conversations by session id — several can be running at once. */
  chats: Record<string, ChatSlice>
  /** Slice of `viewing`, so components read one stable object. */
  current: ChatSlice

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

/** Index of the newest row for `tool`, whatever its state, or -1. */
function findLastToolRow(messages: readonly ChatMessage[], tool: string): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.role === 'tool' && message.toolName === tool) return index
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
        await window.pictor.sendChat(sessionId, trimmed, images.length === 0 ? undefined : images)
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
        patch(sessionId, () => ({
          running: true,
          error: null,
          phase: 'connecting',
          runStartedAt: Date.now(),
          runFinishedAt: null,
          currentTool: null,
          retry: null,
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

      if (event.type === 'tool.started') {
        patch(sessionId, (state) => ({
          phase: 'tool',
          currentTool: event.tool,
          messages: [
            ...state.messages,
            {
              id: `tool-${event.runId}-${String(state.messages.length)}`,
              role: 'tool',
              text: '',
              timestamp: Date.now(),
              toolName: event.tool,
              input: event.input,
            },
          ],
        }))
        return
      }

      if (event.type === 'tool.finished') {
        patch(sessionId, (state) => {
          const messages = [...state.messages]
          const pending = findPendingToolRow(messages, event.tool)

          if (pending >= 0) {
            const existing = messages[pending]
            if (existing !== undefined) {
              messages[pending] = {
                ...existing,
                text: event.output.slice(0, 4000),
                isError: event.isError,
                ...(event.diff === undefined ? {} : { diff: event.diff }),
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

      // The run is over: any tool row still waiting for a result would spin
      // forever, so close it with an explicit outcome.
      patch(sessionId, (state) => ({
        running: false,
        phase: 'idle',
        currentTool: null,
        runFinishedAt: Date.now(),
        ...(event.reason === 'error' ? { error: event.message ?? 'run failed' } : {}),
        messages: state.messages.map((message) =>
          message.role === 'tool' && message.text === ''
            ? { ...message, text: '运行结束时没有拿到结果', isError: true }
            : message,
        ),
      }))
    },
  }
})
