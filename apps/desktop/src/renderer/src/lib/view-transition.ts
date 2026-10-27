import { flushSync } from 'react-dom'

/**
 * Wraps a view change in the browser View Transitions API when available.
 * Falls back to an immediate update, and never animates for reduced motion.
 *
 * The update must land in the DOM synchronously, otherwise the transition
 * aborts with a timeout — hence `flushSync` around the React state change.
 */
export function withViewTransition(update: () => void): void {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches

  if (reduced || typeof document.startViewTransition !== 'function') {
    update()
    return
  }

  const transition = document.startViewTransition(() => {
    flushSync(update)
  })
  // A transition the browser abandons — a second view change arriving before the first
  // cross-fade finished — rejects both of its promises. Nothing was lost: `flushSync` has
  // already put the update in the DOM, and the only casualty is the animation. Caught here
  // so a cross-fade that did not run is not reported as an application error.
  transition.finished.catch(() => undefined)
  transition.ready.catch(() => undefined)
}
