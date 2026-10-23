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
}

export const useApprovalStore = create<ApprovalState>()((set) => ({
  pending: null,
  show: (request) => {
    set({ pending: request })
  },
  clear: () => {
    set({ pending: null })
  },
}))
