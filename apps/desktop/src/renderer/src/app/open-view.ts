import { withViewTransition } from '../lib/view-transition.js'
import { useUiStore } from './ui-store.js'
import type { AppView } from './views.js'

/**
 * Switches the visible view, with the shared transition.
 *
 * Everything that navigates goes through here — rail, menu, shortcuts, panels —
 * so the animation and the state change can never drift apart, and callers never
 * have to reach into the store themselves.
 */
export function openView(view: AppView): void {
  withViewTransition(() => useUiStore.getState().setView(view))
}
