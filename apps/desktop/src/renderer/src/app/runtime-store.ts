import { create } from 'zustand'

import type { HarnessStatus } from '../../../shared/bridge.js'

/**
 * The agent runtime's state, as the window last heard it.
 *
 * A transcript can only be read while the runtime is up, so the chat surface has
 * to know whether "no messages" means an empty conversation or an unreachable
 * one. Anything that changes the runtime reports here, and the initial value is
 * fetched on mount so a window opened later is not left guessing.
 */
interface RuntimeState {
  status: HarnessStatus | null
  set: (status: HarnessStatus) => void
}

export const useRuntimeStore = create<RuntimeState>()((set) => ({
  status: null,
  set: (status) => {
    set({ status })
  },
}))
