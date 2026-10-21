import { create } from 'zustand'

export type AppView = 'home' | 'settings'

/** A place the back/forward buttons can return to. */
export interface AppLocation {
  view: AppView
  sessionId: string | null
}

interface UiState {
  view: AppView
  /** Left column: sections, projects and sessions. */
  leftPanelOpen: boolean
  rightPanelOpen: boolean
  /** Visited places, oldest first. `historyIndex` points at the current one. */
  history: AppLocation[]
  historyIndex: number
  setView: (view: AppView) => void
  toggleLeftPanel: () => void
  toggleRightPanel: () => void
  /** Appends a place unless it is the one already showing. */
  recordLocation: (location: AppLocation) => void
  /** Moves through history and returns the place to show, or null at an end. */
  stepHistory: (direction: -1 | 1) => AppLocation | null
}

export const useUiStore = create<UiState>()((set, get) => ({
  view: 'home',
  leftPanelOpen: true,
  rightPanelOpen: window.matchMedia('(min-width: 1080px)').matches,
  history: [],
  historyIndex: -1,
  setView: (view) => set({ view }),
  toggleLeftPanel: () => set((state) => ({ leftPanelOpen: !state.leftPanelOpen })),
  toggleRightPanel: () => set((state) => ({ rightPanelOpen: !state.rightPanelOpen })),
  recordLocation: (location) =>
    set((state) => {
      const current = state.history[state.historyIndex]
      if (
        current !== undefined &&
        current.view === location.view &&
        current.sessionId === location.sessionId
      ) {
        return {}
      }

      // Moving somewhere new after going back drops the places ahead of us.
      const kept = state.history.slice(0, state.historyIndex + 1)
      return { history: [...kept, location], historyIndex: kept.length }
    }),
  stepHistory: (direction) => {
    const { history, historyIndex } = get()
    const next = historyIndex + direction
    const location = history[next]
    if (location === undefined) return null

    set({ historyIndex: next })
    return location
  },
}))
