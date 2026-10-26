import { create } from 'zustand'

import type { ChatQuestionRequest } from '@pictor/shared'

import { dropPending, dropPendingOf, putPending } from './pending.js'

/**
 * The questions kernels are currently waiting on.
 *
 * Same shape as the approvals, and for the same reason: one held call per
 * conversation, several conversations at once. A kernel that names its conversation
 * gets a sidebar badge; dsh's requests name none, so its card follows whichever
 * conversation is open and no row can claim it.
 */
interface QuestionState {
  pending: ChatQuestionRequest[]
  show: (request: ChatQuestionRequest) => void
  /** Drops one settled question, by the event the kernel is holding. */
  clear: (eventId: string) => void
  /** Drops whatever one conversation was waiting on; a finished run cannot still wait. */
  clearOf: (sessionId: string) => void
}

export const useQuestionStore = create<QuestionState>()((set) => ({
  pending: [],
  show: (request) => {
    set((state) => ({ pending: putPending(state.pending, request) }))
  },
  clear: (eventId) => {
    set((state) => ({ pending: dropPending(state.pending, eventId) }))
  },
  clearOf: (sessionId) => {
    set((state) => ({ pending: dropPendingOf(state.pending, sessionId) }))
  },
}))
