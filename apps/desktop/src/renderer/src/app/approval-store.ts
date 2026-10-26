import { create } from 'zustand'

import type { ApprovalRequest } from '@pictor/shared'

import { dropPending, dropPendingOf, putPending } from './pending.js'

/**
 * The decisions kernels are currently waiting for.
 *
 * One per conversation, because that is what a kernel can hold: Pi keeps one child
 * per conversation and blocks one call in it, dsh blocks one agent. Several
 * conversations can be blocked at once, so the list is what the sidebar badges and
 * the window draws the entry for the conversation on screen.
 */
interface ApprovalState {
  pending: ApprovalRequest[]
  show: (request: ApprovalRequest) => void
  /** Drops one settled decision, by the event the kernel is holding. */
  clear: (eventId: string) => void
  /** Drops whatever one conversation was waiting on; a finished run cannot still wait. */
  clearOf: (sessionId: string) => void
}

export const useApprovalStore = create<ApprovalState>()((set) => ({
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
