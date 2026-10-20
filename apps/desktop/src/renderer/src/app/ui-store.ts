import { create } from 'zustand'

export type AppView = 'home' | 'settings'

interface UiState {
  view: AppView
  rightPanelOpen: boolean
  setView: (view: AppView) => void
  toggleRightPanel: () => void
}

export const useUiStore = create<UiState>()((set) => ({
  view: 'home',
  rightPanelOpen: window.matchMedia('(min-width: 1080px)').matches,
  setView: (view) => set({ view }),
  toggleRightPanel: () => set((state) => ({ rightPanelOpen: !state.rightPanelOpen })),
}))
