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

  document.startViewTransition(() => {
    flushSync(update)
  })
}
