import { create } from 'zustand'

import type { ChatEvent, ChatMessage } from '@pictor/shared'

interface ChatState {
  sessionId: string | null
  path: string | null
  messages: ChatMessage[]
  offset: number
  hasMore: boolean
  loading: boolean
  running: boolean
  /** Wall-clock start of the current run, for the "总时长" label. */
  runStartedAt: number | null
  runFinishedAt: number | null
  /** Coarse phase of the running agent, shown next to its name. */
  phase: 'idle' | 'connecting' | 'thinking' | 'tool' | 'writing'
  currentTool: string | null
  error: string | null
  requestId: number

  open: (sessionId: string | null) => Promise<void>
  close: () => Promise<void>
  send: (prompt: string) => Promise<void>
  stop: () => Promise<void>
  loadOlder: () => Promise<void>
  handleEvent: (event: ChatEvent) => void
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

export const useChatStore = create<ChatState>()((set, get) => ({
  sessionId: null,
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
  requestId: 0,

  async open(sessionId) {
    const requestId = get().requestId + 1
    set({
      requestId,
      sessionId,
      path: null,
      messages: [],
      offset: 0,
      hasMore: false,
      running: false,
      runStartedAt: null,
      runFinishedAt: null,
      phase: 'idle',
      currentTool: null,
      error: null,
      loading: sessionId !== null,
    })

    if (sessionId === null) {
      await window.pictor.closeChat()
      return
    }

    try {
      const result = await window.pictor.openChat(sessionId)
      if (get().requestId !== requestId) return

      set({
        path: result.path,
        messages: result.history.messages,
        offset: result.history.nextOffset,
        hasMore: result.history.hasMore,
      })
    } catch (reason) {
      if (get().requestId !== requestId) return
      set({ error: reason instanceof Error ? reason.message : String(reason) })
    } finally {
      if (get().requestId === requestId) set({ loading: false })
    }
  },

  async close() {
    set({
      requestId: get().requestId + 1,
      sessionId: null,
      path: null,
      messages: [],
      running: false,
      phase: 'idle',
      currentTool: null,
    })
    await window.pictor.closeChat()
  },

  async send(prompt) {
    const path = get().path
    if (path === null || get().running) return

    const trimmed = prompt.trim()
    if (trimmed.length === 0) return

    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      text: trimmed,
      timestamp: Date.now(),
    }

    set({ messages: [...get().messages, userMessage], running: true, error: null })

    try {
      await window.pictor.sendChat(trimmed)
    } catch (reason) {
      set({ running: false, error: reason instanceof Error ? reason.message : String(reason) })
    }
  },

  async stop() {
    await window.pictor.stopChat()
  },

  async loadOlder() {
    const { path, offset, hasMore, messages } = get()
    if (path === null || !hasMore) return

    set({ loading: true })
    try {
      const page = await window.pictor.chatHistory(path, 50, offset)
      set({
        messages: [...page.messages, ...messages],
        offset: page.nextOffset,
        hasMore: page.hasMore,
      })
    } finally {
      set({ loading: false })
    }
  },

  handleEvent(event) {
    if (event.sessionId !== get().sessionId) return

    if (event.type === 'run.started') {
      set({
        running: true,
        error: null,
        phase: 'connecting',
        runStartedAt: Date.now(),
        runFinishedAt: null,
        currentTool: null,
      })
      return
    }

    if (event.type === 'thinking.delta') {
      set((state) => {
        const last = state.messages.at(-1)
        const thinkingId = `thinking-${event.runId}`

        if (last !== undefined && last.kind === 'thinking' && last.id.startsWith(thinkingId)) {
          return {
            phase: 'thinking' as const,
            messages: [...state.messages.slice(0, -1), { ...last, text: last.text + event.text }],
          }
        }

        const segment = state.messages.filter((message) => message.id.startsWith(thinkingId)).length

        return {
          phase: 'thinking' as const,
          messages: [
            ...state.messages,
            {
              id: `${thinkingId}-${segment}`,
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
      set((state) => {
        const last = state.messages.at(-1)
        const streamId = `stream-${event.runId}`

        // Continue the newest answer bubble when it is still the last row.
        if (last !== undefined && last.role === 'assistant' && last.id.startsWith(streamId)) {
          return {
            phase: 'writing' as const,
            messages: [...state.messages.slice(0, -1), { ...last, text: last.text + event.text }],
          }
        }

        // A tool row landed in between, so this is a new assistant segment. It
        // needs its own id: reusing the run id would duplicate a React key and
        // the transcript would stop updating until it remounted.
        const segment = state.messages.filter((message) => message.id.startsWith(streamId)).length

        return {
          phase: 'writing' as const,
          messages: [
            ...state.messages,
            {
              id: `${streamId}-${segment}`,
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
      set((state) => ({
        phase: 'tool' as const,
        currentTool: event.tool,
        messages: [
          ...state.messages,
          {
            id: `tool-${event.runId}-${state.messages.length}`,
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
      set((state) => {
        const messages = [...state.messages]
        const pending = findPendingToolRow(messages, event.tool)

        if (pending >= 0) {
          const existing = messages[pending]
          if (existing !== undefined) {
            messages[pending] = {
              ...existing,
              text: event.output.slice(0, 4000),
              isError: event.isError,
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
              id: `tool-${event.runId}-${messages.length}`,
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
      set((state) => {
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
              id: `tool-${event.runId}-${messages.length}`,
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
    set((state) => ({
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
}))
