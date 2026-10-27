import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { HarnessApp } from './harness/App.js'
import './styles/index.css'

/**
 * Standalone renderer entry.
 *
 * A shell mounts one subtree and gets out of the way: `<HarnessApp />` is the harness's
 * own tree — rail, pages, panels — and everything it draws, it owns. Wiring a second shell
 * would be these same six lines.
 */
export function runStandalone(): void {
  const root = document.getElementById('root')
  if (root === null) throw new Error('没有 #root 可以挂载')

  createRoot(root).render(
    <StrictMode>
      <HarnessApp />
    </StrictMode>,
  )
}

runStandalone()
