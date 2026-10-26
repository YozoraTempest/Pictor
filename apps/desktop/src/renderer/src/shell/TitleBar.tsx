import { Minus, Square, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useUiStore } from '../app/ui-store.js'
import { useWorkspaceStore } from '../app/workspace-store.js'
import { findView } from '../app/views.js'
import { cn } from '../lib/cn.js'
import { GlobalTools, useWindowCommand } from './Toolbar.js'

/**
 * The window's title bar, as a frame rather than a fixed layout.
 *
 * Left and right toolbars belong to the active view; the shared tools (history
 * and the overflow menu) are injected into one of them, and the title sits in the
 * middle so it reads the same whatever a view puts on either side.
 */
export function TitleBar(): React.JSX.Element {
  const view = useUiStore((state) => state.view)
  const kernels = useWorkspaceStore((state) => state.kernels)
  const active = findView(view, kernels)

  const [maximized, setMaximized] = useState(false)
  const command = useWindowCommand()

  useEffect(() => {
    void window.pictor.getWindowState().then((state) => setMaximized(state.maximized))
    return window.pictor.onWindowState((state) => setMaximized(state.maximized))
  }, [])

  const tools = active.tools ?? 'leading'

  return (
    <header className="app-drag relative flex h-9 shrink-0 items-center bg-surface/60">
      {/* Left toolbar: the injected global tools sit at the far left by default,
          with the view's own controls after them. */}
      <div className="flex min-w-0 flex-1 items-center gap-0.5 pl-1.5">
        {tools !== 'trailing' && tools !== 'none' && <GlobalTools />}
        <div className="app-no-drag flex min-w-0 items-center gap-0.5">{active.leading?.()}</div>
      </div>

      {/*
        Absolutely centred so a wide left toolbar cannot push the title off the
        middle; the pointer passes through, and the width cap keeps it clear of
        both toolbars.
      */}
      <p className="pointer-events-none absolute left-1/2 max-w-[45%] -translate-x-1/2 truncate text-2xs text-faint">
        {active.title?.()}
      </p>

      {/* Right toolbar, then the window buttons, which always live at the edge. */}
      <div className="flex shrink-0 items-center">
        {tools === 'trailing' && <GlobalTools />}
        <div className="app-no-drag flex items-center gap-0.5">{active.trailing?.()}</div>

        <div className="app-no-drag ml-1 flex items-center">
          <button
            type="button"
            aria-label="最小化"
            onClick={() => command('minimize')}
            className="grid size-8 place-items-center text-muted transition-colors duration-150 hover:bg-surface-hover hover:text-text"
          >
            <Minus className="size-3.5" />
          </button>
          <button
            type="button"
            aria-label={maximized ? '还原' : '最大化'}
            onClick={() => command('toggleMaximize')}
            className="grid size-8 place-items-center text-muted transition-colors duration-150 hover:bg-surface-hover hover:text-text"
          >
            <Square className={cn(maximized ? 'size-3' : 'size-3.5')} />
          </button>
          <button
            type="button"
            aria-label="关闭"
            onClick={() => command('close')}
            className="grid size-8 place-items-center text-muted transition-colors duration-150 hover:bg-danger/80 hover:text-bg"
          >
            <X className="size-3.5" />
          </button>
        </div>
      </div>
    </header>
  )
}
