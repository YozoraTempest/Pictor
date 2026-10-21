import { create } from 'zustand'

export type AppView = 'home' | 'settings'

interface UiState {
  view: AppView
  /** Left column: sections, projects and sessions. */
  leftPanelOpen: boolean
  rightPanelOpen: boolean
  setView: (view: AppView) => void
  toggleLeftPanel: () => void
  toggleRightPanel: () => void
}

export const useUiStore = create<UiState>()((set) => ({
  view: 'home',
  leftPanelOpen: true,
  rightPanelOpen: window.matchMedia('(min-width: 1080px)').matches,
  setView: (view) => set({ view }),
  toggleLeftPanel: () => set((state) => ({ leftPanelOpen: !state.leftPanelOpen })),
  toggleRightPanel: () => set((state) => ({ rightPanelOpen: !state.rightPanelOpen })),
}))
