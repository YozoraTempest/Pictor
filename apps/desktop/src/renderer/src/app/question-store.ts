import { create } from 'zustand'

import type { ChatQuestionRequest } from '@pictor/shared'

/**
 * The questions the runtime is currently waiting on.
 *
 * One slot, for the same reason approvals keep one: a tool call is blocked until
 * this is answered, and a queue would hide that behind a list nobody scrolls. A
 * newer request replaces an older one, exactly as the wire does.
 */
interface QuestionState {
  pending: ChatQuestionRequest | null
  show: (request: ChatQuestionRequest) => void
  clear: () => void
}

export const useQuestionStore = create<QuestionState>()((set) => ({
  pending: null,
  show: (request) => {
    set({ pending: request })
  },
  clear: () => {
    set({ pending: null })
  },
}))
