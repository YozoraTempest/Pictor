import { kernelViewId } from '../kernel-scope.js'
import { openView } from './open-view.js'
import { useUiStore } from './ui-store.js'
import { useWorkspaceStore } from './workspace-store.js'
import type { AppView } from './views.js'

/**
 * Brings one conversation to the screen, whichever page it lives on.
 *
 * A conversation belongs to the kernel that produced it, so it is listed on that
 * kernel's page only. Jumping to one therefore means two moves — pick the page, then
 * pick the conversation — and the order matters: selecting first would briefly open
 * it on a page that does not list it. The transcript itself follows from the
 * selection, which the app already watches.
 *
 * Returns false when the conversation is not in the workspace any more (deleted, or
 * never created because the run failed): a card that offered "go there" for a place
 * that no longer exists would be a dead button.
 */
export function openSession(sessionId: string): boolean {
  const state = useWorkspaceStore.getState()
  const session = state.sessions.find((entry) => entry.id === sessionId)
  if (session === undefined) return false

  // The page of the engine that ran it. A conversation whose engine is no longer mounted
  // still names it; the view registry falls back to the engine that is.
  const view: AppView = kernelViewId(session.kernelId)

  if (useUiStore.getState().view !== view) openView(view)
  state.selectSession(sessionId)
  return true
}
