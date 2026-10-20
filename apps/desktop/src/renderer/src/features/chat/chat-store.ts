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
  error: string | null
  requestId: number

  open: (sessionId: string | null) => Promise<void>
  close: () => Promise<void>
  send: (prompt: string) => Promise<void>
  stop: () => Promise<void>
  loadOlder: () => Promise<void>
  handleEvent: (event: ChatEvent) => void
}

export const useChatStore = create<ChatState>()((set, get) => ({
  sessionId: null,
  path: null,
  messages: [],
  offset: 0,
  hasMore: false,
  loading: false,
  running: false,
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
      set({ running: true, error: null })
      return
    }

    if (event.type === 'message.delta') {
      set((state) => {
        const last = state.messages.at(-1)
        if (last !== undefined && last.id === `stream-${event.runId}`) {
          return {
            messages: [...state.messages.slice(0, -1), { ...last, text: last.text + event.text }],
          }
        }

        return {
          messages: [
            ...state.messages,
            {
              id: `stream-${event.runId}`,
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
        messages: [
          ...state.messages,
          {
            id: `tool-${event.runId}-${state.messages.length}`,
            role: 'tool',
            text: '',
            timestamp: Date.now(),
            toolName: event.tool,
          },
        ],
      }))
      return
    }

    if (event.type === 'tool.finished') {
      set((state) => {
        const messages = [...state.messages]
        const index = messages.findIndex(
          (message) =>
            message.role === 'tool' &&
            message.toolName === event.tool &&
            (message.text === '' || message.blocked === true),
        )

        if (index >= 0) {
          const existing = messages[index]
          // A guarded call already has its verdict; Pi still reports the tool as
          // finished, and overwriting the reason with a generic error would hide
          // the only explanation the user gets.
          if (existing !== undefined && existing.blocked !== true) {
            messages[index] = {
              ...existing,
              text: event.output.slice(0, 4000),
              isError: event.isError,
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
        const index = messages.findIndex(
          (message) =>
            message.role === 'tool' && message.toolName === event.tool && message.text === '',
        )

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

    set({
      running: false,
      ...(event.reason === 'error' ? { error: event.message ?? 'run failed' } : {}),
    })
  },
}))
