import { create } from 'zustand'

import type { AppView } from './views.js'

/** A place the back/forward buttons can return to. */
export interface AppLocation {
  view: AppView
  sessionId: string | null
}

/** Grace period for crossing from the switch into the sidebar, in milliseconds. */
const PEEK_LINGER = 180

/** Column width bounds, shared by the drawer, its divider and the right panel. */
export const SIDEBAR_DEFAULT = 240
export const SIDEBAR_MIN = 200
export const SIDEBAR_MAX = 360
export const RIGHT_DEFAULT = 288
export const RIGHT_MIN = 240
export const RIGHT_MAX = 420

interface UiState {
  view: AppView
  /** Left column: sections, projects and sessions. */
  leftPanelOpen: boolean
  rightPanelOpen: boolean
  /**
   * Column widths live here rather than in a view component: a view unmounts on
   * every navigation, so local state would snap back to the default each time.
   */
  sidebarWidth: number
  rightWidth: number
  /** True while the divider is dragged, so the width transition stays off. */
  sidebarResizing: boolean
  /** True while an unpinned sidebar is previewed on hover. */
  sidebarPeeking: boolean
  /** Visited places, oldest first. `historyIndex` points at the current one. */
  history: AppLocation[]
  historyIndex: number
  /** Conversation whose family tree is open; `null` closes the dialog. */
  branchTreeFor: string | null
  /**
   * The plugin panel being shown, by panel id.
   *
   * Null means the panel column shows its launcher list: the buttons a person uses to
   * pick one. Opening a panel replaces the list rather than pushing a route, because the
   * column is small and going back is one button.
   */
  openPanel: string | null
  openPanelNamed: (id: string) => void
  closePanel: () => void
  /**
   * The plugin page occupying the centre, by its `main` slot key.
   *
   * Null means the conversation. `main` is a keyed slot and `conversation` is its
   * reserved key, so a plugin page is the same kind of thing as the transcript — which is
   * why going back is one field, not a navigation stack.
   */
  mainPage: string | null
  openMainPage: (key: string) => void
  closeMainPage: () => void
  setView: (view: AppView) => void
  toggleLeftPanel: () => void
  toggleRightPanel: () => void
  setSidebarWidth: (width: number) => void
  setRightWidth: (width: number) => void
  setSidebarResizing: (resizing: boolean) => void
  /** Opens or closes the hover preview; leaving keeps a short grace period. */
  peekSidebar: (enter: boolean) => void
  /** Appends a place unless it is the one already showing. */
  recordLocation: (location: AppLocation) => void
  /** Moves through history and returns the place to show, or null at an end. */
  stepHistory: (direction: -1 | 1) => AppLocation | null
  showBranchTree: (sessionId: string) => void
  hideBranchTree: () => void
}

/** Pending "close the preview" timer, shared by the switch and the drawer. */
let peekTimer: number | null = null

function cancelPeekTimer(): void {
  if (peekTimer === null) return
  window.clearTimeout(peekTimer)
  peekTimer = null
}

export const useUiStore = create<UiState>()((set, get) => ({
  // Empty until the workspace reports its engine: the first view is derived from what
  // is mounted, and there is no home page to fall back to.
  view: '' as AppView,
  leftPanelOpen: true,
  rightPanelOpen: window.matchMedia('(min-width: 1080px)').matches,
  sidebarWidth: SIDEBAR_DEFAULT,
  rightWidth: RIGHT_DEFAULT,
  sidebarResizing: false,
  sidebarPeeking: false,
  history: [],
  historyIndex: -1,
  branchTreeFor: null,
  openPanel: null,
  mainPage: null,
  setView: (view) => set({ view }),
  toggleLeftPanel: () =>
    set((state) => {
      const leftPanelOpen = !state.leftPanelOpen
      // A pinned panel needs no preview, and the timer must not outlive it.
      if (leftPanelOpen) {
        cancelPeekTimer()
        return { leftPanelOpen, sidebarPeeking: false }
      }
      return { leftPanelOpen }
    }),
  toggleRightPanel: () => set((state) => ({ rightPanelOpen: !state.rightPanelOpen })),
  setSidebarWidth: (sidebarWidth) => set({ sidebarWidth }),
  setRightWidth: (rightWidth) => set({ rightWidth }),
  setSidebarResizing: (sidebarResizing) => set({ sidebarResizing }),
  peekSidebar: (enter) => {
    cancelPeekTimer()
    if (enter) {
      if (!get().leftPanelOpen) set({ sidebarPeeking: true })
      return
    }
    peekTimer = window.setTimeout(() => {
      peekTimer = null
      set({ sidebarPeeking: false })
    }, PEEK_LINGER)
  },
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
  showBranchTree: (sessionId) => set({ branchTreeFor: sessionId }),
  hideBranchTree: () => set({ branchTreeFor: null }),
  openPanelNamed: (id) => set({ openPanel: id, rightPanelOpen: true }),
  closePanel: () => set({ openPanel: null }),
  openMainPage: (key) => set({ mainPage: key, rightPanelOpen: true }),
  closeMainPage: () => set({ mainPage: null }),
  stepHistory: (direction) => {
    const { history, historyIndex } = get()
    const next = historyIndex + direction
    const location = history[next]
    if (location === undefined) return null

    set({ historyIndex: next })
    return location
  },
}))
