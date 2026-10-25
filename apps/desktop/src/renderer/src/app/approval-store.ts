import { create } from 'zustand'

import type { ApprovalRequest } from '@pictor/shared'

/**
 * The decision the runtime is currently waiting for.
 *
 * One slot on purpose: the runtime asks one question at a time per client, and a
 * queue would hide the fact that a tool call is blocked behind a list nobody
 * scrolls. A newer request replaces an older one, exactly as the wire does.
 */
interface ApprovalState {
  pending: ApprovalRequest | null
  show: (request: ApprovalRequest) => void
  clear: () => void
  /**
   * Drops a request that a conversation no longer needs answered.
   *
   * A kernel that names the conversation can end a run with its dialog cancelled on
   * the other side; the card must go with it rather than sit there looking unanswered.
   * A request with no conversation (dsh) is left alone: nothing here can tell whether
   * an unrelated turn finishing means its answer is moot.
   */
  clearOf: (sessionId: string) => void
}

export const useApprovalStore = create<ApprovalState>()((set) => ({
  pending: null,
  show: (request) => {
    set({ pending: request })
  },
  clear: () => {
    set({ pending: null })
  },
  clearOf: (sessionId) => {
    set((state) =>
      state.pending !== null && state.pending.sessionId === sessionId ? { pending: null } : state,
    )
  },
}))
